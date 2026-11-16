package app

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	auditMediaMaxItemBytes = 50 << 20        // 50 MiB per item
	auditMediaCacheMax     = 2 << 30         // 2 GiB total cache
	auditBase64SanitizeMin = 256             // sanitize base64 > 256 chars
	auditMediaPlaceholder  = "[多媒体文件已提取: #%d %s · %s -> %s]"
)

var (
	auditMediaCacheMu sync.Mutex

	reDataURI = regexp.MustCompile(`data:((?:image|audio|video)/[a-zA-Z0-9.+_-]+)(?:;[a-zA-Z0-9=_-]+)*;base64,([A-Za-z0-9+/=_\r\n-]+)`)
	reMdMedia = regexp.MustCompile(`!\[([^\]]*)\]\(([^)\s]+)\)`)
	reHTMLSrc = regexp.MustCompile(`(?i)<(img|audio|video|source)\b[^>]*\bsrc=["']([^"']+)["']`)

	// Fallback regexes for truncated JSON (e.g. MCP result.content[] or Gemini inlineData cut off at 409600 bytes)
	reTruncMCPBlock  = regexp.MustCompile(`"type"\s*:\s*"(image|audio|video)"[^}]{0,400}?"(?:data|mimeType)"\s*:\s*"([^"]+)"`)
	reTruncDataField = regexp.MustCompile(`"(?:data|b64_json)"\s*:\s*"([A-Za-z0-9+/=_-]{257,})"?`)
	reTruncMimeField = regexp.MustCompile(`"(?:mimeType|mime_type)"\s*:\s*"((?:image|audio|video)/[^"]+)"`)
	reLongBase64JSON = regexp.MustCompile(`("(?:data|b64_json|image_bytes|audio_bytes|video_bytes)"\s*:\s*")([A-Za-z0-9+/=_\r\n-]{257,})("?)`)
)

type AuditMediaItem struct {
	Idx       int    `json:"idx"`
	Side      string `json:"side"` // "req" | "res"
	Kind      string `json:"kind"` // "image" | "audio" | "video" | "file"
	MIME      string `json:"mime"`
	Ext       string `json:"ext"`
	Bytes     int64  `json:"bytes"`
	HumanSize string `json:"human_size"`
	Source    string `json:"source"`
	URL       string `json:"url"`
}

type AuditContentBlock struct {
	Type string `json:"type"` // "text" | "image" | "audio" | "video" | "tool_call" | "tool_result" | "thinking"
	Role string `json:"role,omitempty"`
	Text string `json:"text,omitempty"`
	MIME string `json:"mime,omitempty"`
	URL  string `json:"url,omitempty"`
	Name string `json:"name,omitempty"`
	Args string `json:"args,omitempty"`
}

type AuditMCPInfo struct {
	Method       string   `json:"method,omitempty"`
	ID           any      `json:"id,omitempty"`
	ToolName     string   `json:"tool_name,omitempty"`
	Arguments    any      `json:"arguments,omitempty"`
	IsError      bool     `json:"is_error,omitempty"`
	ContentTypes []string `json:"content_types,omitempty"`
}

type AuditMediaSummary struct {
	ReqCount   int      `json:"req_count"`
	ResCount   int      `json:"res_count"`
	TotalCount int      `json:"total_count"`
	ReqTypes   []string `json:"req_types,omitempty"`
	ResTypes   []string `json:"res_types,omitempty"`
	TotalBytes int64    `json:"total_bytes"`
	HumanSize  string   `json:"human_size"`
}

type AuditDetailResult struct {
	ReqMedia       []AuditMediaItem    `json:"req_media"`
	ResMedia       []AuditMediaItem    `json:"res_media"`
	RequestBlocks  []AuditContentBlock `json:"request_blocks"`
	ResponseBlocks []AuditContentBlock `json:"response_blocks"`
	MCPInfo        *AuditMCPInfo       `json:"mcp_info,omitempty"`
	MediaSummary   *AuditMediaSummary  `json:"media_summary"`
	RequestBody    string              `json:"request_body"`
	Reply          string              `json:"reply"`
	Raw            string              `json:"raw"`
}

func auditMediaDir() string {
	return filepath.Join(auditDir(), "audit-media")
}

func humanBytes(n int64) string {
	switch {
	case n >= 1<<30:
		return fmt.Sprintf("%.2f GiB", float64(n)/float64(1<<30))
	case n >= 1<<20:
		return fmt.Sprintf("%.2f MiB", float64(n)/float64(1<<20))
	case n >= 1<<10:
		return fmt.Sprintf("%.1f KiB", float64(n)/float64(1<<10))
	default:
		return fmt.Sprintf("%d B", n)
	}
}

func sniffMediaMIME(data []byte, hint string) (mime string, ext string) {
	if len(data) >= 3 && data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF {
		return "image/jpeg", ".jpg"
	}
	if len(data) >= 8 && bytes.Equal(data[:8], []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1A, '\n'}) {
		return "image/png", ".png"
	}
	if len(data) >= 6 && (bytes.Equal(data[:6], []byte("GIF87a")) || bytes.Equal(data[:6], []byte("GIF89a"))) {
		return "image/gif", ".gif"
	}
	if len(data) >= 12 && bytes.Equal(data[:4], []byte("RIFF")) && bytes.Equal(data[8:12], []byte("WEBP")) {
		return "image/webp", ".webp"
	}
	if len(data) >= 12 && bytes.Equal(data[:4], []byte("RIFF")) && bytes.Equal(data[8:12], []byte("WAVE")) {
		return "audio/wav", ".wav"
	}
	if len(data) >= 3 && bytes.Equal(data[:3], []byte("ID3")) {
		return "audio/mpeg", ".mp3"
	}
	if len(data) >= 2 && data[0] == 0xFF && (data[1]&0xE0) == 0xE0 {
		return "audio/mpeg", ".mp3"
	}
	if len(data) >= 4 && bytes.Equal(data[:4], []byte("OggS")) {
		return "audio/ogg", ".ogg"
	}
	if len(data) >= 8 && bytes.Equal(data[4:8], []byte("ftyp")) {
		return "video/mp4", ".mp4"
	}
	if len(data) >= 4 && bytes.Equal(data[:4], []byte{0x1A, 0x45, 0xDF, 0xA3}) {
		return "video/webm", ".webm"
	}

	h := strings.ToLower(strings.TrimSpace(hint))
	switch {
	case strings.Contains(h, "jpeg") || strings.Contains(h, "jpg"):
		return "image/jpeg", ".jpg"
	case strings.Contains(h, "png"):
		return "image/png", ".png"
	case strings.Contains(h, "gif"):
		return "image/gif", ".gif"
	case strings.Contains(h, "webp"):
		return "image/webp", ".webp"
	case strings.Contains(h, "wav"):
		return "audio/wav", ".wav"
	case strings.Contains(h, "mp3") || strings.Contains(h, "mpeg"):
		return "audio/mpeg", ".mp3"
	case strings.Contains(h, "ogg"):
		return "audio/ogg", ".ogg"
	case strings.Contains(h, "mp4"):
		return "video/mp4", ".mp4"
	case strings.Contains(h, "webm"):
		return "video/webm", ".webm"
	case strings.HasPrefix(h, "image/"):
		return h, ".bin"
	case strings.HasPrefix(h, "audio/"):
		return h, ".bin"
	case strings.HasPrefix(h, "video/"):
		return h, ".bin"
	default:
		return "application/octet-stream", ".bin"
	}
}

func mimeKind(mime string) string {
	switch {
	case strings.HasPrefix(mime, "image/"):
		return "image"
	case strings.HasPrefix(mime, "audio/"):
		return "audio"
	case strings.HasPrefix(mime, "video/"):
		return "video"
	default:
		return "file"
	}
}

func wrapPCMAsWAV(pcm []byte, sampleRate, channels, bitsPerSample int) []byte {
	if sampleRate <= 0 {
		sampleRate = 24000
	}
	if channels <= 0 {
		channels = 1
	}
	if bitsPerSample <= 0 {
		bitsPerSample = 16
	}
	byteRate := sampleRate * channels * bitsPerSample / 8
	blockAlign := channels * bitsPerSample / 8
	dataSize := len(pcm)

	var buf bytes.Buffer
	buf.Grow(44 + dataSize)
	buf.WriteString("RIFF")
	_ = binary.Write(&buf, binary.LittleEndian, uint32(36+dataSize))
	buf.WriteString("WAVE")
	buf.WriteString("fmt ")
	_ = binary.Write(&buf, binary.LittleEndian, uint32(16))
	_ = binary.Write(&buf, binary.LittleEndian, uint16(1)) // PCM
	_ = binary.Write(&buf, binary.LittleEndian, uint16(channels))
	_ = binary.Write(&buf, binary.LittleEndian, uint32(sampleRate))
	_ = binary.Write(&buf, binary.LittleEndian, uint32(byteRate))
	_ = binary.Write(&buf, binary.LittleEndian, uint16(blockAlign))
	_ = binary.Write(&buf, binary.LittleEndian, uint16(bitsPerSample))
	buf.WriteString("data")
	_ = binary.Write(&buf, binary.LittleEndian, uint32(dataSize))
	buf.Write(pcm)
	return buf.Bytes()
}

func isPCMFormat(formatHint string) bool {
	f := strings.ToLower(strings.TrimSpace(formatHint))
	return f == "pcm" || f == "pcm16" || f == "linear16" || f == "audio/pcm" || f == "audio/l16"
}

func decodeBase64Flexible(s string) ([]byte, bool) {
	s = strings.TrimSpace(s)
	s = strings.ReplaceAll(s, "\r", "")
	s = strings.ReplaceAll(s, "\n", "")
	if s == "" {
		return nil, false
	}
	for _, enc := range []*base64.Encoding{
		base64.StdEncoding,
		base64.RawStdEncoding,
		base64.URLEncoding,
		base64.RawURLEncoding,
	} {
		if b, err := enc.DecodeString(s); err == nil && len(b) > 0 {
			return b, true
		}
	}
	return nil, false
}

type mediaExtractor struct {
	auditID      int64
	side         string
	items        []AuditMediaItem
	replacements map[string]string
}

func newMediaExtractor(auditID int64, side string) *mediaExtractor {
	return &mediaExtractor{
		auditID:      auditID,
		side:         side,
		replacements: make(map[string]string),
	}
}

func (me *mediaExtractor) addBytes(rawBytes []byte, mimeHint, source, rawToken string, wrapPCM bool) *AuditMediaItem {
	if len(rawBytes) == 0 || int64(len(rawBytes)) > auditMediaMaxItemBytes {
		return nil
	}
	if wrapPCM && (isPCMFormat(mimeHint) || !hasKnownContainerMagic(rawBytes)) {
		rawBytes = wrapPCMAsWAV(rawBytes, 24000, 1, 16)
		mimeHint = "audio/wav"
	}
	mime, ext := sniffMediaMIME(rawBytes, mimeHint)
	idx := len(me.items)
	url := fmt.Sprintf("/admin/api/audits/%d/media/%s/%d", me.auditID, me.side, idx)
	hSize := humanBytes(int64(len(rawBytes)))

	if err := cacheAuditMediaFile(me.auditID, me.side, idx, ext, rawBytes); err != nil {
		logf("[audit] cache media failed: %v", err)
	}

	item := AuditMediaItem{
		Idx:       idx,
		Side:      me.side,
		Kind:      mimeKind(mime),
		MIME:      mime,
		Ext:       ext,
		Bytes:     int64(len(rawBytes)),
		HumanSize: hSize,
		Source:    source,
		URL:       url,
	}
	me.items = append(me.items, item)

	if rawToken != "" && len(rawToken) > auditBase64SanitizeMin {
		placeholder := fmt.Sprintf(auditMediaPlaceholder, idx, mime, hSize, url)
		me.replacements[rawToken] = placeholder
	}
	return &item
}

func hasKnownContainerMagic(data []byte) bool {
	mime, _ := sniffMediaMIME(data, "")
	return mime != "application/octet-stream"
}

func (me *mediaExtractor) addDataURI(uri, source string) *AuditMediaItem {
	m := reDataURI.FindStringSubmatch(uri)
	if len(m) != 3 {
		return nil
	}
	b, ok := decodeBase64Flexible(m[2])
	if !ok {
		return nil
	}
	return me.addBytes(b, m[1], source, uri, false)
}

func (me *mediaExtractor) addBase64(b64, mimeHint, source string, wrapPCM bool) *AuditMediaItem {
	b, ok := decodeBase64Flexible(b64)
	if !ok {
		return nil
	}
	return me.addBytes(b, mimeHint, source, b64, wrapPCM)
}

func (me *mediaExtractor) scanTextForMedia(text, source string) {
	if text == "" {
		return
	}
	for _, m := range reDataURI.FindAllString(text, -1) {
		if _, seen := me.replacements[m]; !seen {
			me.addDataURI(m, source)
		}
	}
}

func (me *mediaExtractor) sanitize(text string) string {
	if text == "" {
		return ""
	}
	for tok, placeholder := range me.replacements {
		if strings.Contains(text, tok) {
			text = strings.ReplaceAll(text, tok, placeholder)
		}
	}
	// Replace any remaining large data: URIs
	text = reDataURI.ReplaceAllStringFunc(text, func(m string) string {
		if len(m) <= auditBase64SanitizeMin {
			return m
		}
		sub := reDataURI.FindStringSubmatch(m)
		mime := "application/octet-stream"
		if len(sub) >= 2 {
			mime = sub[1]
		}
		return fmt.Sprintf("[多媒体文件已提取: %s · %s]", mime, humanBytes(int64(len(m)*3/4)))
	})
	// Replace any remaining large base64 JSON fields (>256 chars)
	text = reLongBase64JSON.ReplaceAllStringFunc(text, func(m string) string {
		sub := reLongBase64JSON.FindStringSubmatch(m)
		if len(sub) < 4 {
			return m
		}
		return fmt.Sprintf("%s[base64 已省略 · %s]%s", sub[1], humanBytes(int64(len(sub[2])*3/4)), sub[3])
	})
	return text
}

func cacheAuditMediaFile(auditID int64, side string, idx int, ext string, data []byte) error {
	dir := auditMediaDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	name := fmt.Sprintf("%d_%s_%d%s", auditID, side, idx, ext)
	dst := filepath.Join(dir, name)
	if st, err := os.Stat(dst); err == nil && st.Size() == int64(len(data)) {
		now := time.Now()
		_ = os.Chtimes(dst, now, now)
		return nil
	}
	tmp := dst + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	if err := os.Rename(tmp, dst); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	go enforceMediaCacheLimit()
	return nil
}

func findCachedMediaFile(auditID int64, side string, idx int) (string, bool) {
	dir := auditMediaDir()
	prefix := fmt.Sprintf("%d_%s_%d.", auditID, side, idx)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return "", false
	}
	for _, e := range entries {
		if !e.IsDir() && strings.HasPrefix(e.Name(), prefix) {
			return filepath.Join(dir, e.Name()), true
		}
	}
	return "", false
}

func loadCachedMediaItems(auditID int64, side string) []AuditMediaItem {
	dir := auditMediaDir()
	prefix := fmt.Sprintf("%d_%s_", auditID, side)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	var items []AuditMediaItem
	for _, e := range entries {
		if e.IsDir() || strings.HasSuffix(e.Name(), ".tmp") || !strings.HasPrefix(e.Name(), prefix) {
			continue
		}
		rest := strings.TrimPrefix(e.Name(), prefix)
		ext := filepath.Ext(rest)
		idxStr := strings.TrimSuffix(rest, ext)
		idx, err := strconv.Atoi(idxStr)
		if err != nil || idx < 0 {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		mime, _ := sniffMediaMIME(nil, ext)
		items = append(items, AuditMediaItem{
			Idx:       idx,
			Side:      side,
			Kind:      mimeKind(mime),
			MIME:      mime,
			Ext:       ext,
			Bytes:     info.Size(),
			HumanSize: humanBytes(info.Size()),
			Source:    "cached_media",
			URL:       fmt.Sprintf("/admin/api/audits/%d/media/%s/%d", auditID, side, idx),
		})
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Idx < items[j].Idx })
	return items
}

func enforceMediaCacheLimit() {
	auditMediaCacheMu.Lock()
	defer auditMediaCacheMu.Unlock()

	dir := auditMediaDir()
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	type fileInfo struct {
		path    string
		size    int64
		modTime time.Time
	}
	var files []fileInfo
	var total int64
	for _, e := range entries {
		if e.IsDir() || strings.HasSuffix(e.Name(), ".tmp") {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		sz := info.Size()
		total += sz
		files = append(files, fileInfo{
			path:    filepath.Join(dir, e.Name()),
			size:    sz,
			modTime: info.ModTime(),
		})
	}
	if total <= auditMediaCacheMax {
		return
	}
	sort.Slice(files, func(i, j int) bool {
		return files[i].modTime.Before(files[j].modTime)
	})
	for _, f := range files {
		if total <= auditMediaCacheMax {
			break
		}
		if err := os.Remove(f.path); err == nil {
			total -= f.size
		}
	}
}

func extractAuditDetail(auditID int64, reqBody, reply, raw, reasoning, toolCalls string) *AuditDetailResult {
	reqEx := newMediaExtractor(auditID, "req")
	resEx := newMediaExtractor(auditID, "res")

	var reqBlocks []AuditContentBlock
	var resBlocks []AuditContentBlock
	var mcpInfo *AuditMCPInfo

	// 1. Request extraction
	if strings.TrimSpace(reqBody) != "" {
		var reqMap map[string]any
		if err := json.Unmarshal([]byte(reqBody), &reqMap); err == nil {
			if method, ok := reqMap["method"].(string); ok && method != "" {
				mcpInfo = &AuditMCPInfo{
					Method: method,
					ID:     reqMap["id"],
				}
				if params, ok := reqMap["params"].(map[string]any); ok {
					if name, ok := params["name"].(string); ok {
						mcpInfo.ToolName = name
					}
					mcpInfo.Arguments = params["arguments"]
				}
			}
			reqBlocks = extractBlocksFromRequest(reqMap, reqEx)
		} else {
			reqEx.scanTextForMedia(reqBody, "request_raw")
		}
	}

	// 2. Response extraction (from raw, reply, tool_calls)
	if strings.TrimSpace(raw) != "" {
		if isSSERaw(raw) {
			resBlocks = extractFromSSERaw(raw, resEx)
		} else {
			var resMap map[string]any
			if err := json.Unmarshal([]byte(raw), &resMap); err == nil {
				if mcpRes, ok := resMap["result"].(map[string]any); ok {
					if mcpInfo == nil {
						mcpInfo = &AuditMCPInfo{ID: resMap["id"]}
					}
					if isErr, ok := mcpRes["isError"].(bool); ok {
						mcpInfo.IsError = isErr
					}
					resBlocks, mcpInfo.ContentTypes = extractFromMCPResult(mcpRes, resEx)
				} else {
					resBlocks = extractBlocksFromResponseJSON(resMap, resEx)
				}
			} else {
				// Truncated JSON regex fallback
				extractTruncatedFallback(raw, resEx, &resBlocks)
			}
		}
	}

	// Also scan reply and toolCalls for embedded markdown/HTML/data URI media
	if reply != "" {
		resEx.scanTextForMedia(reply, "reply")
		extractMarkdownHTMLMedia(reply, resEx, &resBlocks)
	}
	if toolCalls != "" {
		resEx.scanTextForMedia(toolCalls, "tool_calls")
	}
	if len(resEx.items) == 0 {
		if cached := loadCachedMediaItems(auditID, "res"); len(cached) > 0 {
			resEx.items = cached
			for _, it := range cached {
				resBlocks = append(resBlocks, AuditContentBlock{
					Type: it.Kind,
					MIME: it.MIME,
					URL:  it.URL,
				})
			}
		}
	}

	if len(resBlocks) == 0 && (reply != "" || reasoning != "") {
		if reasoning != "" {
			resBlocks = append(resBlocks, AuditContentBlock{Type: "thinking", Text: reasoning})
		}
		if reply != "" {
			resBlocks = append(resBlocks, AuditContentBlock{Type: "text", Text: resEx.sanitize(reply)})
		}
	}

	summary := buildMediaSummary(reqEx.items, resEx.items)
	return &AuditDetailResult{
		ReqMedia:       nonNilMedia(reqEx.items),
		ResMedia:       nonNilMedia(resEx.items),
		RequestBlocks:  nonNilBlocks(reqBlocks),
		ResponseBlocks: nonNilBlocks(resBlocks),
		MCPInfo:        mcpInfo,
		MediaSummary:   summary,
		RequestBody:    reqEx.sanitize(reqBody),
		Reply:          resEx.sanitize(reply),
		Raw:            resEx.sanitize(raw),
	}
}

func nonNilMedia(s []AuditMediaItem) []AuditMediaItem {
	if s == nil {
		return []AuditMediaItem{}
	}
	return s
}

func nonNilBlocks(s []AuditContentBlock) []AuditContentBlock {
	if s == nil {
		return []AuditContentBlock{}
	}
	return s
}

func buildMediaSummary(req, res []AuditMediaItem) *AuditMediaSummary {
	var totalBytes int64
	reqTypesMap := map[string]bool{}
	resTypesMap := map[string]bool{}
	for _, it := range req {
		totalBytes += it.Bytes
		reqTypesMap[it.Kind] = true
	}
	for _, it := range res {
		totalBytes += it.Bytes
		resTypesMap[it.Kind] = true
	}
	var reqTypes, resTypes []string
	for k := range reqTypesMap {
		reqTypes = append(reqTypes, k)
	}
	for k := range resTypesMap {
		resTypes = append(resTypes, k)
	}
	sort.Strings(reqTypes)
	sort.Strings(resTypes)
	return &AuditMediaSummary{
		ReqCount:   len(req),
		ResCount:   len(res),
		TotalCount: len(req) + len(res),
		ReqTypes:   reqTypes,
		ResTypes:   resTypes,
		TotalBytes: totalBytes,
		HumanSize:  humanBytes(totalBytes),
	}
}

func isSSERaw(raw string) bool {
	trimmed := strings.TrimSpace(raw)
	return strings.HasPrefix(trimmed, "data:") || strings.Contains(raw, "\ndata:")
}

func extractBlocksFromRequest(m map[string]any, ex *mediaExtractor) []AuditContentBlock {
	var blocks []AuditContentBlock

	if msgs, ok := m["messages"].([]any); ok {
		for _, msgAny := range msgs {
			msg, ok := msgAny.(map[string]any)
			if !ok {
				continue
			}
			role, _ := msg["role"].(string)
			blocks = append(blocks, extractContentField(msg["content"], role, ex)...)
		}
	}
	if contents, ok := m["contents"].([]any); ok {
		for _, cAny := range contents {
			c, ok := cAny.(map[string]any)
			if !ok {
				continue
			}
			role, _ := c["role"].(string)
			if parts, ok := c["parts"].([]any); ok {
				blocks = append(blocks, extractGeminiParts(parts, role, ex)...)
			}
		}
	}
	if inp, ok := m["input"].(string); ok && inp != "" {
		ex.scanTextForMedia(inp, "input")
		blocks = append(blocks, AuditContentBlock{Type: "text", Role: "user", Text: ex.sanitize(inp)})
	} else if inpArr, ok := m["input"].([]any); ok {
		for _, itemAny := range inpArr {
			item, ok := itemAny.(map[string]any)
			if !ok {
				continue
			}
			role, _ := item["role"].(string)
			blocks = append(blocks, extractContentField(item["content"], role, ex)...)
		}
	}
	// MCP arguments might contain image_urls or data URIs
	if params, ok := m["params"].(map[string]any); ok {
		if args, ok := params["arguments"].(map[string]any); ok {
			b, _ := json.Marshal(args)
			ex.scanTextForMedia(string(b), "mcp_args")
		}
	}
	return blocks
}

func extractContentField(v any, role string, ex *mediaExtractor) []AuditContentBlock {
	var blocks []AuditContentBlock
	switch val := v.(type) {
	case string:
		ex.scanTextForMedia(val, "content")
		if val != "" {
			blocks = append(blocks, AuditContentBlock{Type: "text", Role: role, Text: ex.sanitize(val)})
		}
	case []any:
		for _, itemAny := range val {
			item, ok := itemAny.(map[string]any)
			if !ok {
				continue
			}
			tp, _ := item["type"].(string)
			switch tp {
			case "text", "input_text", "output_text":
				if t, ok := item["text"].(string); ok && t != "" {
					ex.scanTextForMedia(t, "text")
					blocks = append(blocks, AuditContentBlock{Type: "text", Role: role, Text: ex.sanitize(t)})
				}
			case "image_url", "input_image":
				var urlStr string
				if iu, ok := item["image_url"].(map[string]any); ok {
					urlStr, _ = iu["url"].(string)
				} else if u, ok := item["image_url"].(string); ok {
					urlStr = u
				} else if u, ok := item["url"].(string); ok {
					urlStr = u
				}
				if strings.HasPrefix(urlStr, "data:") {
					if mi := ex.addDataURI(urlStr, tp); mi != nil {
						blocks = append(blocks, AuditContentBlock{Type: mi.Kind, Role: role, MIME: mi.MIME, URL: mi.URL})
					}
				} else if urlStr != "" {
					blocks = append(blocks, AuditContentBlock{Type: "image", Role: role, URL: urlStr})
				}
			case "input_audio":
				if ia, ok := item["input_audio"].(map[string]any); ok {
					dataStr, _ := ia["data"].(string)
					formatStr, _ := ia["format"].(string)
					if mi := ex.addBase64(dataStr, formatStr, "input_audio", true); mi != nil {
						blocks = append(blocks, AuditContentBlock{Type: mi.Kind, Role: role, MIME: mi.MIME, URL: mi.URL})
					}
				}
			case "input_video", "video_url":
				if iv, ok := item["input_video"].(map[string]any); ok {
					dataStr, _ := iv["data"].(string)
					formatStr, _ := iv["format"].(string)
					if mi := ex.addBase64(dataStr, formatStr, "input_video", false); mi != nil {
						blocks = append(blocks, AuditContentBlock{Type: mi.Kind, Role: role, MIME: mi.MIME, URL: mi.URL})
					}
				} else if vu, ok := item["video_url"].(map[string]any); ok {
					urlStr, _ := vu["url"].(string)
					if strings.HasPrefix(urlStr, "data:") {
						if mi := ex.addDataURI(urlStr, tp); mi != nil {
							blocks = append(blocks, AuditContentBlock{Type: mi.Kind, Role: role, MIME: mi.MIME, URL: mi.URL})
						}
					} else if urlStr != "" {
						blocks = append(blocks, AuditContentBlock{Type: "video", Role: role, URL: urlStr})
					}
				}
			case "image":
				// Anthropic image block: {"type":"image","source":{"type":"base64","media_type":"image/png","data":"..."}}
				if src, ok := item["source"].(map[string]any); ok {
					dataStr, _ := src["data"].(string)
					mt, _ := src["media_type"].(string)
					if mi := ex.addBase64(dataStr, mt, "anthropic_image", false); mi != nil {
						blocks = append(blocks, AuditContentBlock{Type: mi.Kind, Role: role, MIME: mi.MIME, URL: mi.URL})
					}
				}
			}
		}
	}
	return blocks
}

func extractGeminiParts(parts []any, role string, ex *mediaExtractor) []AuditContentBlock {
	var blocks []AuditContentBlock
	for _, pAny := range parts {
		p, ok := pAny.(map[string]any)
		if !ok {
			continue
		}
		if t, ok := p["text"].(string); ok && t != "" {
			ex.scanTextForMedia(t, "gemini_text")
			blocks = append(blocks, AuditContentBlock{Type: "text", Role: role, Text: ex.sanitize(t)})
		}
		var inline map[string]any
		if v, ok := p["inlineData"].(map[string]any); ok {
			inline = v
		} else if v, ok := p["inline_data"].(map[string]any); ok {
			inline = v
		}
		if inline != nil {
			dataStr, _ := inline["data"].(string)
			mt, _ := inline["mimeType"].(string)
			if mt == "" {
				mt, _ = inline["mime_type"].(string)
			}
			if mi := ex.addBase64(dataStr, mt, "gemini_inlineData", false); mi != nil {
				blocks = append(blocks, AuditContentBlock{Type: mi.Kind, Role: role, MIME: mi.MIME, URL: mi.URL})
			}
		}
	}
	return blocks
}

func extractFromMCPResult(res map[string]any, ex *mediaExtractor) ([]AuditContentBlock, []string) {
	var blocks []AuditContentBlock
	var types []string
	content, ok := res["content"].([]any)
	if !ok {
		return blocks, types
	}
	for _, itemAny := range content {
		item, ok := itemAny.(map[string]any)
		if !ok {
			continue
		}
		tp, _ := item["type"].(string)
		if tp != "" {
			types = append(types, tp)
		}
		switch tp {
		case "text":
			if t, ok := item["text"].(string); ok && t != "" {
				ex.scanTextForMedia(t, "mcp_text")
				blocks = append(blocks, AuditContentBlock{Type: "text", Text: ex.sanitize(t)})
			}
		case "image", "audio", "video":
			dataStr, _ := item["data"].(string)
			mt, _ := item["mimeType"].(string)
			if mi := ex.addBase64(dataStr, mt, "mcp_"+tp, false); mi != nil {
				blocks = append(blocks, AuditContentBlock{Type: mi.Kind, MIME: mi.MIME, URL: mi.URL})
			}
		case "resource":
			if r, ok := item["resource"].(map[string]any); ok {
				blob, _ := r["blob"].(string)
				mt, _ := r["mimeType"].(string)
				if blob != "" {
					if mi := ex.addBase64(blob, mt, "mcp_resource", false); mi != nil {
						blocks = append(blocks, AuditContentBlock{Type: mi.Kind, MIME: mi.MIME, URL: mi.URL})
					}
				} else if t, ok := r["text"].(string); ok && t != "" {
					blocks = append(blocks, AuditContentBlock{Type: "text", Text: t})
				}
			}
		}
	}
	return blocks, types
}

func extractBlocksFromResponseJSON(m map[string]any, ex *mediaExtractor) []AuditContentBlock {
	var blocks []AuditContentBlock

	// OpenAI images generation: {"data":[{"b64_json":"..."}]}
	if dataArr, ok := m["data"].([]any); ok {
		for _, itemAny := range dataArr {
			if item, ok := itemAny.(map[string]any); ok {
				if b64, ok := item["b64_json"].(string); ok && b64 != "" {
					if mi := ex.addBase64(b64, "image/png", "b64_json", false); mi != nil {
						blocks = append(blocks, AuditContentBlock{Type: mi.Kind, MIME: mi.MIME, URL: mi.URL})
					}
				}
			}
		}
	}

	// OpenAI chat completions
	if choices, ok := m["choices"].([]any); ok {
		for _, cAny := range choices {
			c, ok := cAny.(map[string]any)
			if !ok {
				continue
			}
			msg, ok := c["message"].(map[string]any)
			if !ok {
				continue
			}
			if rc, ok := msg["reasoning_content"].(string); ok && rc != "" {
				blocks = append(blocks, AuditContentBlock{Type: "thinking", Role: "assistant", Text: rc})
			}
			blocks = append(blocks, extractContentField(msg["content"], "assistant", ex)...)
			if imgs, ok := msg["images"].([]any); ok {
				blocks = append(blocks, extractContentField(imgs, "assistant", ex)...)
			}
			if audioObj, ok := msg["audio"].(map[string]any); ok {
				if b64, ok := audioObj["data"].(string); ok && b64 != "" {
					if mi := ex.addBase64(b64, "audio/wav", "openai_audio", true); mi != nil {
						blocks = append(blocks, AuditContentBlock{Type: mi.Kind, Role: "assistant", MIME: mi.MIME, URL: mi.URL})
					}
				}
			}
		}
	}

	// Gemini candidates
	if cands, ok := m["candidates"].([]any); ok {
		for _, cAny := range cands {
			if c, ok := cAny.(map[string]any); ok {
				if content, ok := c["content"].(map[string]any); ok {
					if parts, ok := content["parts"].([]any); ok {
						blocks = append(blocks, extractGeminiParts(parts, "model", ex)...)
					}
				}
			}
		}
	}

	return blocks
}

func extractFromSSERaw(raw string, ex *mediaExtractor) []AuditContentBlock {
	var textBuf, reasonBuf strings.Builder
	var blocks []AuditContentBlock

	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		payload := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if payload == "" || payload == "[DONE]" {
			continue
		}
		var chunk map[string]any
		if err := json.Unmarshal([]byte(payload), &chunk); err != nil {
			continue
		}
		if choices, ok := chunk["choices"].([]any); ok {
			for _, cAny := range choices {
				c, ok := cAny.(map[string]any)
				if !ok {
					continue
				}
				delta, ok := c["delta"].(map[string]any)
				if !ok {
					continue
				}
				if s, ok := delta["content"].(string); ok {
					textBuf.WriteString(s)
				}
				if s, ok := delta["reasoning_content"].(string); ok {
					reasonBuf.WriteString(s)
				}
				if imgs, ok := delta["images"].([]any); ok {
					blocks = append(blocks, extractContentField(imgs, "assistant", ex)...)
				}
				if audioObj, ok := delta["audio"].(map[string]any); ok {
					if b64, ok := audioObj["data"].(string); ok && b64 != "" {
						if mi := ex.addBase64(b64, "audio/wav", "sse_audio", true); mi != nil {
							blocks = append(blocks, AuditContentBlock{Type: mi.Kind, Role: "assistant", MIME: mi.MIME, URL: mi.URL})
						}
					}
				}
			}
		}
		if cands, ok := chunk["candidates"].([]any); ok {
			for _, cAny := range cands {
				if c, ok := cAny.(map[string]any); ok {
					if content, ok := c["content"].(map[string]any); ok {
						if parts, ok := content["parts"].([]any); ok {
							blocks = append(blocks, extractGeminiParts(parts, "model", ex)...)
						}
					}
				}
			}
		}
	}

	if reasonBuf.Len() > 0 {
		blocks = append([]AuditContentBlock{{Type: "thinking", Role: "assistant", Text: reasonBuf.String()}}, blocks...)
	}
	if textBuf.Len() > 0 {
		txt := textBuf.String()
		ex.scanTextForMedia(txt, "sse_text")
		extractMarkdownHTMLMedia(txt, ex, &blocks)
		blocks = append(blocks, AuditContentBlock{Type: "text", Role: "assistant", Text: ex.sanitize(txt)})
	}
	return blocks
}

func extractMarkdownHTMLMedia(text string, ex *mediaExtractor, blocks *[]AuditContentBlock) {
	for _, m := range reMdMedia.FindAllStringSubmatch(text, -1) {
		if len(m) < 3 {
			continue
		}
		src := m[2]
		if strings.HasPrefix(src, "data:") {
			if _, seen := ex.replacements[src]; !seen {
				if mi := ex.addDataURI(src, "markdown_media"); mi != nil {
					*blocks = append(*blocks, AuditContentBlock{Type: mi.Kind, MIME: mi.MIME, URL: mi.URL})
				}
			}
		} else if strings.HasPrefix(src, "http://") || strings.HasPrefix(src, "https://") {
			*blocks = append(*blocks, AuditContentBlock{Type: "image", URL: src})
		}
	}
	for _, m := range reHTMLSrc.FindAllStringSubmatch(text, -1) {
		if len(m) < 3 {
			continue
		}
		tag := strings.ToLower(m[1])
		src := m[2]
		if strings.HasPrefix(src, "data:") {
			if _, seen := ex.replacements[src]; !seen {
				if mi := ex.addDataURI(src, "html_"+tag); mi != nil {
					*blocks = append(*blocks, AuditContentBlock{Type: mi.Kind, MIME: mi.MIME, URL: mi.URL})
				}
			}
		} else if strings.HasPrefix(src, "http://") || strings.HasPrefix(src, "https://") {
			kind := "image"
			if tag == "audio" {
				kind = "audio"
			} else if tag == "video" {
				kind = "video"
			}
			*blocks = append(*blocks, AuditContentBlock{Type: kind, URL: src})
		}
	}
}

func extractTruncatedFallback(raw string, ex *mediaExtractor, blocks *[]AuditContentBlock) {
	ex.scanTextForMedia(raw, "truncated_data_uri")

	var mimeHint string
	if mm := reTruncMimeField.FindStringSubmatch(raw); len(mm) >= 2 {
		mimeHint = mm[1]
	}
	for _, dm := range reTruncDataField.FindAllStringSubmatch(raw, -1) {
		if len(dm) < 2 {
			continue
		}
		b64 := dm[1]
		if _, seen := ex.replacements[b64]; seen {
			continue
		}
		if mi := ex.addBase64(b64, mimeHint, "truncated_json", false); mi != nil {
			*blocks = append(*blocks, AuditContentBlock{Type: mi.Kind, MIME: mi.MIME, URL: mi.URL})
		}
	}
	_ = reTruncMCPBlock
	_ = strconv.Itoa
}
