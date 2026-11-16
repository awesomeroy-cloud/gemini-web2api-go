package app

import (
	"bytes"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	auditRawCap          = 409600
	auditMediaCaptureCap = 32 << 20 // 32 MiB max media capture for audit-media cache
	auditReqBodyCap      = 16 << 20 // 16 MiB max request body capture
	auditQueueSize       = 512
	auditPreviewMaxRun   = 200
)

const auditSchema = `
CREATE TABLE IF NOT EXISTS audit_meta (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    ts               INTEGER NOT NULL,
    client_ip        TEXT NOT NULL DEFAULT '',
    method           TEXT NOT NULL DEFAULT '',
    path             TEXT NOT NULL DEFAULT '',
    model            TEXT NOT NULL DEFAULT '',
    served_model     TEXT NOT NULL DEFAULT '',
    stream           INTEGER NOT NULL DEFAULT 0,
    status           INTEGER NOT NULL DEFAULT 0,
    failed           INTEGER NOT NULL DEFAULT 0,
    ttfb_ms          INTEGER NOT NULL DEFAULT 0,
    first_data_ms    INTEGER NOT NULL DEFAULT 0,
    total_ms         INTEGER NOT NULL DEFAULT 0,
    pings            INTEGER NOT NULL DEFAULT 0,
    prompt_tokens    INTEGER NOT NULL DEFAULT 0,
    output_tokens    INTEGER NOT NULL DEFAULT 0,
    error_preview    TEXT NOT NULL DEFAULT '',
    request_preview  TEXT NOT NULL DEFAULT '',
    reply_preview    TEXT NOT NULL DEFAULT '',
    raw_bytes        INTEGER NOT NULL DEFAULT 0,
    raw_truncated    INTEGER NOT NULL DEFAULT 0,
    v                INTEGER NOT NULL DEFAULT 2,
    issue            TEXT NOT NULL DEFAULT '',
    finish_reason    TEXT NOT NULL DEFAULT '',
    resp_id          TEXT NOT NULL DEFAULT '',
    key_fp           TEXT NOT NULL DEFAULT '',
    account          TEXT NOT NULL DEFAULT '',
    proxy            TEXT NOT NULL DEFAULT '',
    attempts         INTEGER NOT NULL DEFAULT 0,
    upstream_ttfb_ms INTEGER NOT NULL DEFAULT 0,
    upstream_ms      INTEGER NOT NULL DEFAULT 0,
    chunks           INTEGER NOT NULL DEFAULT 0,
    cached_tokens    INTEGER NOT NULL DEFAULT 0,
    reasoning_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens     INTEGER NOT NULL DEFAULT 0,
    tool_call_count  INTEGER NOT NULL DEFAULT 0,
    params_summary   TEXT NOT NULL DEFAULT '',
    user_agent       TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_audit_meta_ts ON audit_meta(ts);
CREATE INDEX IF NOT EXISTS idx_audit_meta_status ON audit_meta(status);
CREATE INDEX IF NOT EXISTS idx_audit_meta_model ON audit_meta(model);
CREATE INDEX IF NOT EXISTS idx_audit_meta_issue ON audit_meta(issue);
CREATE INDEX IF NOT EXISTS idx_audit_meta_account ON audit_meta(account);
CREATE INDEX IF NOT EXISTS idx_audit_meta_path ON audit_meta(path);

CREATE TABLE IF NOT EXISTS audit_body (
    id            INTEGER PRIMARY KEY,
    error         TEXT NOT NULL DEFAULT '',
    request_body  TEXT NOT NULL DEFAULT '',
    reply         TEXT NOT NULL DEFAULT '',
    reasoning     TEXT NOT NULL DEFAULT '',
    raw           TEXT NOT NULL DEFAULT '',
    content_type  TEXT NOT NULL DEFAULT '',
    user_agent    TEXT NOT NULL DEFAULT '',
    query         TEXT NOT NULL DEFAULT '',
    req_headers   TEXT NOT NULL DEFAULT '',
    res_headers   TEXT NOT NULL DEFAULT '',
    params        TEXT NOT NULL DEFAULT '',
    system_prompt TEXT NOT NULL DEFAULT '',
    tool_calls    TEXT NOT NULL DEFAULT ''
);
`

var (
	auditDBMu   sync.Mutex
	auditDB     *sql.DB
	auditDBPath string

	auditWriterOnce sync.Once
	auditCh         chan *auditRecord

	auditMaintOnce sync.Once
)

type auditRecord struct {
	TS             int64
	ClientIP       string
	Method         string
	Path           string
	Model          string
	ServedModel    string
	Stream         int
	Status         int
	Failed         int
	TTFBMs         int64
	FirstDataMs    int64
	TotalMs        int64
	Pings          int
	PromptTokens   int
	OutputTokens   int
	ErrorPreview   string
	RequestPreview string
	ReplyPreview   string
	RawBytes       int
	RawTruncated   int
	V              int
	Issue          string
	FinishReason   string
	RespID         string
	KeyFP          string
	Account        string
	Proxy          string
	Attempts       int
	UpstreamTTFBMs int64
	UpstreamMs     int64
	Chunks         int
	CachedTokens   int
	ReasoningTokens int
	TotalTokens    int
	ToolCallCount  int
	ParamsSummary  string
	UserAgent      string

	// audit_body fields
	Error        string
	RequestBody  string
	Reply        string
	Reasoning    string
	Raw          string
	ContentType  string
	Query        string
	ReqHeaders   string
	ResHeaders   string
	Params       string
	SystemPrompt string
	ToolCalls    string

	PendingMedia []pendingAuditMedia
}

type pendingAuditMedia struct {
	ext  string
	data []byte
}

func auditDir() string {
	p := cfg.DBPath
	if p == "" {
		p = "./data/gemini.db"
	}
	return filepath.Dir(p)
}

func getAuditDB() *sql.DB {
	dir := auditDir()
	dbFile := filepath.Join(dir, "audit.db")

	auditDBMu.Lock()
	defer auditDBMu.Unlock()

	if auditDB != nil && auditDBPath == dbFile {
		return auditDB
	}
	if auditDB != nil {
		_ = auditDB.Close()
		auditDB = nil
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		logf("[audit] mkdir %s failed: %v", dir, err)
		return nil
	}

	dsn := fmt.Sprintf("file:%s?_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)&_pragma=busy_timeout(5000)", dbFile)
	conn, err := sql.Open("sqlite", dsn)
	if err != nil {
		logf("[audit] open %s failed: %v", dbFile, err)
		return nil
	}
	conn.SetMaxOpenConns(4)
	conn.SetMaxIdleConns(2)
	conn.SetConnMaxLifetime(0)

	for _, pragma := range []string{
		"PRAGMA journal_mode=WAL;",
		"PRAGMA synchronous=NORMAL;",
		"PRAGMA busy_timeout=5000;",
	} {
		_, _ = conn.Exec(pragma)
	}
	if _, err := conn.Exec(auditSchema); err != nil {
		logf("[audit] init schema failed: %v", err)
		_ = conn.Close()
		return nil
	}
	migrateAuditV1(conn)
	migrateAuditV2(conn)

	auditDB = conn
	auditDBPath = dbFile
	return auditDB
}

func migrateAuditV1(conn *sql.DB) {
	cols := []string{
		"ALTER TABLE audit_meta ADD COLUMN v INTEGER NOT NULL DEFAULT 2",
		"ALTER TABLE audit_meta ADD COLUMN issue TEXT NOT NULL DEFAULT ''",
		"ALTER TABLE audit_meta ADD COLUMN finish_reason TEXT NOT NULL DEFAULT ''",
		"ALTER TABLE audit_meta ADD COLUMN resp_id TEXT NOT NULL DEFAULT ''",
		"ALTER TABLE audit_meta ADD COLUMN key_fp TEXT NOT NULL DEFAULT ''",
		"ALTER TABLE audit_meta ADD COLUMN account TEXT NOT NULL DEFAULT ''",
		"ALTER TABLE audit_meta ADD COLUMN proxy TEXT NOT NULL DEFAULT ''",
		"ALTER TABLE audit_meta ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0",
		"ALTER TABLE audit_meta ADD COLUMN upstream_ttfb_ms INTEGER NOT NULL DEFAULT 0",
		"ALTER TABLE audit_meta ADD COLUMN upstream_ms INTEGER NOT NULL DEFAULT 0",
		"ALTER TABLE audit_meta ADD COLUMN chunks INTEGER NOT NULL DEFAULT 0",
	}
	for _, stmt := range cols {
		_, _ = conn.Exec(stmt)
	}
}

func migrateAuditV2(conn *sql.DB) {
	cols := []string{
		"ALTER TABLE audit_meta ADD COLUMN cached_tokens INTEGER NOT NULL DEFAULT 0",
		"ALTER TABLE audit_meta ADD COLUMN reasoning_tokens INTEGER NOT NULL DEFAULT 0",
		"ALTER TABLE audit_meta ADD COLUMN total_tokens INTEGER NOT NULL DEFAULT 0",
		"ALTER TABLE audit_meta ADD COLUMN tool_call_count INTEGER NOT NULL DEFAULT 0",
		"ALTER TABLE audit_meta ADD COLUMN params_summary TEXT NOT NULL DEFAULT ''",
		"ALTER TABLE audit_meta ADD COLUMN user_agent TEXT NOT NULL DEFAULT ''",
		"ALTER TABLE audit_body ADD COLUMN params TEXT NOT NULL DEFAULT ''",
		"ALTER TABLE audit_body ADD COLUMN system_prompt TEXT NOT NULL DEFAULT ''",
		"ALTER TABLE audit_body ADD COLUMN tool_calls TEXT NOT NULL DEFAULT ''",
	}
	for _, stmt := range cols {
		_, _ = conn.Exec(stmt)
	}
}

func startAuditWriter() {
	auditWriterOnce.Do(func() {
		auditCh = make(chan *auditRecord, auditQueueSize)
		go func() {
			for rec := range auditCh {
				insertAudit(rec)
			}
		}()
	})
}

func enqueueAudit(rec *auditRecord) {
	if rec == nil {
		return
	}
	startAuditWriter()
	select {
	case auditCh <- rec:
	default:
		logf("[audit] queue full, dropping record for %s %s", rec.Method, rec.Path)
	}
}

func insertAudit(rec *auditRecord) {
	conn := getAuditDB()
	if conn == nil {
		return
	}
	tx, err := conn.Begin()
	if err != nil {
		logf("[audit] begin tx failed: %v", err)
		return
	}
	defer func() { _ = tx.Rollback() }()

	res, err := tx.Exec(`INSERT INTO audit_meta (
		ts, client_ip, method, path, model, served_model, stream, status, failed,
		ttfb_ms, first_data_ms, total_ms, pings, prompt_tokens, output_tokens,
		error_preview, request_preview, reply_preview, raw_bytes, raw_truncated,
		v, issue, finish_reason, resp_id, key_fp, account, proxy, attempts,
		upstream_ttfb_ms, upstream_ms, chunks, cached_tokens, reasoning_tokens,
		total_tokens, tool_call_count, params_summary, user_agent
	) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		rec.TS, rec.ClientIP, rec.Method, rec.Path, rec.Model, rec.ServedModel, rec.Stream, rec.Status, rec.Failed,
		rec.TTFBMs, rec.FirstDataMs, rec.TotalMs, rec.Pings, rec.PromptTokens, rec.OutputTokens,
		rec.ErrorPreview, rec.RequestPreview, rec.ReplyPreview, rec.RawBytes, rec.RawTruncated,
		rec.V, rec.Issue, rec.FinishReason, rec.RespID, rec.KeyFP, rec.Account, rec.Proxy, rec.Attempts,
		rec.UpstreamTTFBMs, rec.UpstreamMs, rec.Chunks, rec.CachedTokens, rec.ReasoningTokens,
		rec.TotalTokens, rec.ToolCallCount, rec.ParamsSummary, rec.UserAgent,
	)
	if err != nil {
		logf("[audit] insert meta failed: %v", err)
		return
	}
	id, err := res.LastInsertId()
	if err != nil {
		logf("[audit] last insert id failed: %v", err)
		return
	}
	_, err = tx.Exec(`INSERT INTO audit_body (
		id, error, request_body, reply, reasoning, raw, content_type,
		user_agent, query, req_headers, res_headers, params, system_prompt, tool_calls
	) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		id, rec.Error, rec.RequestBody, rec.Reply, rec.Reasoning, rec.Raw, rec.ContentType,
		rec.UserAgent, rec.Query, rec.ReqHeaders, rec.ResHeaders, rec.Params, rec.SystemPrompt, rec.ToolCalls,
	)
	if err != nil {
		logf("[audit] insert body failed: %v", err)
		return
	}
	if err := tx.Commit(); err != nil {
		logf("[audit] commit failed: %v", err)
		return
	}
	for i, pm := range rec.PendingMedia {
		if len(pm.data) > 0 {
			if err := cacheAuditMediaFile(id, "res", i, pm.ext, pm.data); err != nil {
				logf("[audit] cache media failed: %v", err)
			}
		}
	}
}

// auditWriter wraps http.ResponseWriter to capture status, timings, and raw response body up to auditRawCap.
type auditWriter struct {
	w           http.ResponseWriter
	startedAt   time.Time
	status      int
	wroteHeader bool
	firstByteMs int64
	firstDataMs int64
	pings       int
	chunks      int
	rawBytes    int
	truncated   bool
	account     string
	proxy       string
	buf         bytes.Buffer
	mediaBuf    bytes.Buffer
	mediaCapHit bool
}

// auditSetAttribution records account and proxy attribution on the active auditWriter.
func auditSetAttribution(w http.ResponseWriter, res *StreamResult) {
	if res == nil {
		return
	}
	if aw, ok := w.(*auditWriter); ok {
		aw.account = res.AccountLabel
		aw.proxy = res.ProxyName
	}
}

func (aw *auditWriter) Header() http.Header {
	return aw.w.Header()
}

func (aw *auditWriter) WriteHeader(code int) {
	if aw.wroteHeader {
		return
	}
	aw.status = code
	aw.wroteHeader = true
	if aw.firstByteMs == 0 {
		aw.firstByteMs = time.Since(aw.startedAt).Milliseconds()
	}
	aw.w.WriteHeader(code)
}

func (aw *auditWriter) Write(p []byte) (int, error) {
	if !aw.wroteHeader {
		aw.WriteHeader(http.StatusOK)
	}
	nowMs := time.Since(aw.startedAt).Milliseconds()
	if aw.firstByteMs == 0 {
		aw.firstByteMs = nowMs
	}
	aw.chunks++
	aw.rawBytes += len(p)

	if len(p) > 0 {
		trimmed := bytes.TrimSpace(p)
		if bytes.HasPrefix(trimmed, []byte(":")) {
			aw.pings++
		} else if aw.firstDataMs == 0 && len(trimmed) > 0 {
			aw.firstDataMs = nowMs
		}
	}

	if aw.buf.Len() < auditRawCap {
		rem := auditRawCap - aw.buf.Len()
		if len(p) <= rem {
			aw.buf.Write(p)
		} else {
			aw.buf.Write(p[:rem])
			aw.truncated = true
			aw.captureMediaOverflow(p[rem:])
		}
	} else if len(p) > 0 {
		aw.truncated = true
		aw.captureMediaOverflow(p)
	}

	return aw.w.Write(p)
}

func isBinaryMediaCT(ct string) bool {
	low := strings.ToLower(strings.TrimSpace(ct))
	return strings.HasPrefix(low, "video/") || strings.HasPrefix(low, "audio/") || strings.HasPrefix(low, "image/")
}

func (aw *auditWriter) captureMediaOverflow(extra []byte) {
	if len(extra) == 0 || aw.mediaCapHit {
		return
	}
	if aw.mediaBuf.Len() == 0 {
		b := aw.buf.Bytes()
		if !isBinaryMediaCT(aw.Header().Get("Content-Type")) &&
			!bytes.Contains(b, []byte("data:image/")) &&
			!bytes.Contains(b, []byte("data:audio/")) &&
			!bytes.Contains(b, []byte("data:video/")) {
			return
		}
	}
	maxExtra := auditMediaCaptureCap - auditRawCap
	rem := maxExtra - aw.mediaBuf.Len()
	if rem <= 0 {
		aw.mediaCapHit = true
		return
	}
	if len(extra) <= rem {
		aw.mediaBuf.Write(extra)
	} else {
		aw.mediaBuf.Write(extra[:rem])
		aw.mediaCapHit = true
	}
}

func (aw *auditWriter) Flush() {
	if f, ok := aw.w.(http.Flusher); ok {
		f.Flush()
	}
}

func (aw *auditWriter) Unwrap() http.ResponseWriter {
	return aw.w
}

func shouldAuditPath(p string) bool {
	return strings.HasPrefix(p, "/v1/") ||
		strings.HasPrefix(p, "/v1beta/") ||
		p == "/mcp" ||
		strings.HasPrefix(p, "/mcp/")
}

// auditMiddleware records /v1/*, /v1beta/*, and /mcp requests asynchronously.
func auditMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !shouldAuditPath(r.URL.Path) || r.Method == http.MethodOptions {
			next.ServeHTTP(w, r)
			return
		}

		startedAt := time.Now()
		var reqBody []byte
		if r.Body != nil {
			lr := io.LimitReader(r.Body, auditReqBodyCap+1)
			b, err := io.ReadAll(lr)
			_ = r.Body.Close()
			if err == nil {
				reqBody = b
				r.Body = io.NopCloser(bytes.NewReader(reqBody))
			}
		}

		aw := &auditWriter{
			w:         w,
			startedAt: startedAt,
			status:    http.StatusOK,
		}
		next.ServeHTTP(aw, r)

		totalMs := time.Since(startedAt).Milliseconds()
		rec := buildAuditRecord(r, reqBody, aw, startedAt, totalMs)
		enqueueAudit(rec)
	})
}

func auditClientIP(r *http.Request) string {
	for _, hdr := range []string{"CF-Connecting-IP", "X-Real-IP", "X-Forwarded-For"} {
		if v := strings.TrimSpace(r.Header.Get(hdr)); v != "" {
			if idx := strings.IndexByte(v, ','); idx >= 0 {
				v = strings.TrimSpace(v[:idx])
			}
			if v != "" {
				return v
			}
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil && host != "" {
		return host
	}
	return r.RemoteAddr
}

func auditKeyFingerprint(r *http.Request) string {
	var raw string
	if auth := r.Header.Get("Authorization"); strings.HasPrefix(auth, "Bearer ") {
		raw = strings.TrimSpace(auth[7:])
	} else if k := r.Header.Get("x-api-key"); k != "" {
		raw = strings.TrimSpace(k)
	} else if k := r.Header.Get("x-goog-api-key"); k != "" {
		raw = strings.TrimSpace(k)
	} else if k := r.URL.Query().Get("key"); k != "" {
		raw = strings.TrimSpace(k)
	}
	if raw == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:6])
}

func sanitizeAuditHeaders(h http.Header) string {
	if len(h) == 0 {
		return "{}"
	}
	out := make(map[string]string, len(h))
	for k, vals := range h {
		lk := strings.ToLower(k)
		if lk == "authorization" || lk == "cookie" || lk == "set-cookie" || lk == "x-api-key" || lk == "x-goog-api-key" {
			out[k] = "[redacted]"
			continue
		}
		out[k] = strings.Join(vals, ", ")
	}
	b, _ := json.Marshal(out)
	return string(b)
}

func truncateRunes(s string, maxRunes int) string {
	s = strings.TrimSpace(s)
	if maxRunes <= 0 || s == "" {
		return ""
	}
	r := []rune(s)
	if len(r) <= maxRunes {
		return s
	}
	return string(r[:maxRunes]) + "…"
}

func buildAuditRecord(r *http.Request, reqBody []byte, aw *auditWriter, startedAt time.Time, totalMs int64) *auditRecord {
	rawStr := aw.buf.String()
	reqStr := string(reqBody)
	ct := aw.Header().Get("Content-Type")

	rec := &auditRecord{
		TS:          startedAt.Unix(),
		ClientIP:    auditClientIP(r),
		Method:      r.Method,
		Path:        r.URL.Path,
		Status:      aw.status,
		TTFBMs:      aw.firstByteMs,
		FirstDataMs: aw.firstDataMs,
		TotalMs:     totalMs,
		Pings:       aw.pings,
		RawBytes:    aw.rawBytes,
		V:           2,
		KeyFP:       auditKeyFingerprint(r),
		Account:     aw.account,
		Proxy:       aw.proxy,
		Chunks:      aw.chunks,
		UserAgent:   r.UserAgent(),
		RequestBody: reqStr,
		Raw:         rawStr,
		ContentType: ct,
		Query:       r.URL.RawQuery,
		ReqHeaders:  sanitizeAuditHeaders(r.Header),
		ResHeaders:  sanitizeAuditHeaders(aw.Header()),
	}
	if aw.truncated {
		rec.RawTruncated = 1
	}

	// Infer model from URL path if Gemini API shape (/v1beta/models/{model}:action)
	if strings.Contains(r.URL.Path, "/models/") {
		parts := strings.SplitN(r.URL.Path, "/models/", 2)
		if len(parts) == 2 {
			m := parts[1]
			if colon := strings.IndexByte(m, ':'); colon > 0 {
				action := m[colon+1:]
				if strings.Contains(strings.ToLower(action), "stream") {
					rec.Stream = 1
				}
				m = m[:colon]
			}
			rec.Model = m
		}
	}

	parseAuditRequest(reqStr, rec)
	if isBinaryMediaCT(ct) && aw.status == http.StatusOK {
		fullBytes := aw.buf.Bytes()
		if aw.mediaBuf.Len() > 0 {
			fullBytes = append(append([]byte(nil), fullBytes...), aw.mediaBuf.Bytes()...)
		} else {
			fullBytes = append([]byte(nil), fullBytes...)
		}
		if len(fullBytes) > 0 {
			mime, ext := sniffMediaMIME(fullBytes, ct)
			rec.PendingMedia = []pendingAuditMedia{{ext: ext, data: fullBytes}}
			rec.Raw = fmt.Sprintf("[binary %s · %s]", mime, humanBytes(int64(len(fullBytes))))
			rec.Reply = rec.Raw
		}
	} else if aw.mediaBuf.Len() > 0 {
		fullStr := rawStr + aw.mediaBuf.String()
		parseAuditResponse(fullStr, ct, rec)
		for _, m := range reDataURI.FindAllStringSubmatch(fullStr, -1) {
			if len(m) < 3 {
				continue
			}
			if decoded, ok := decodeBase64Flexible(m[2]); ok {
				_, ext := sniffMediaMIME(decoded, m[1])
				rec.PendingMedia = append(rec.PendingMedia, pendingAuditMedia{ext: ext, data: decoded})
			}
		}
	} else {
		parseAuditResponse(rawStr, ct, rec)
	}

	if strings.Contains(strings.ToLower(ct), "text/event-stream") {
		rec.Stream = 1
	}

	rec.Issue, rec.Failed = classifyAudit(rec)
	rec.ErrorPreview = truncateRunes(rec.Error, auditPreviewMaxRun)
	rec.RequestPreview = truncateRunes(rec.RequestPreview, auditPreviewMaxRun)
	rec.ReplyPreview = truncateRunes(rec.ReplyPreview, auditPreviewMaxRun)
	return rec
}

func parseAuditRequest(reqStr string, rec *auditRecord) {
	if strings.TrimSpace(reqStr) == "" {
		return
	}
	var m map[string]any
	if err := json.Unmarshal([]byte(reqStr), &m); err != nil {
		return
	}

	if v, ok := m["model"].(string); ok && v != "" {
		rec.Model = v
	}
	if v, ok := m["stream"].(bool); ok && v {
		rec.Stream = 1
	}

	// MCP JSON-RPC request
	if method, ok := m["method"].(string); ok && method != "" {
		if rec.Model == "" {
			rec.Model = "mcp"
		}
		preview := method
		if params, ok := m["params"].(map[string]any); ok {
			if name, ok := params["name"].(string); ok && name != "" {
				preview += " · " + name
			}
			if args, ok := params["arguments"].(map[string]any); ok {
				if prompt, ok := args["prompt"].(string); ok && prompt != "" {
					preview += ": " + prompt
				} else if q, ok := args["query"].(string); ok && q != "" {
					preview += ": " + q
				}
			}
		}
		rec.RequestPreview = preview
		return
	}

	// Params extraction
	paramKeys := []string{"temperature", "top_p", "top_k", "max_tokens", "max_completion_tokens", "max_output_tokens", "reasoning_effort", "thinking", "response_format"}
	paramsMap := make(map[string]any)
	var summaryParts []string
	for _, k := range paramKeys {
		if v, exists := m[k]; exists && v != nil {
			paramsMap[k] = v
			summaryParts = append(summaryParts, fmt.Sprintf("%s=%v", k, v))
		}
	}
	if tools, ok := m["tools"].([]any); ok && len(tools) > 0 {
		summaryParts = append(summaryParts, fmt.Sprintf("tools=%d", len(tools)))
	}
	if len(paramsMap) > 0 {
		b, _ := json.Marshal(paramsMap)
		rec.Params = string(b)
	}
	rec.ParamsSummary = strings.Join(summaryParts, " ")

	// System prompt
	var sysParts []string
	if sys, ok := m["system"].(string); ok && sys != "" {
		sysParts = append(sysParts, sys)
	} else if sysArr, ok := m["system"].([]any); ok {
		for _, item := range sysArr {
			if obj, ok := item.(map[string]any); ok {
				if t, ok := obj["text"].(string); ok && t != "" {
					sysParts = append(sysParts, t)
				}
			}
		}
	}
	if inst, ok := m["instructions"].(string); ok && inst != "" {
		sysParts = append(sysParts, inst)
	}
	if si, ok := m["systemInstruction"].(map[string]any); ok {
		if t := extractGeminiPartsText(si["parts"]); t != "" {
			sysParts = append(sysParts, t)
		}
	}

	// OpenAI messages / Responses input / Gemini contents
	var lastUser string
	if msgs, ok := m["messages"].([]any); ok {
		for _, msg := range msgs {
			obj, ok := msg.(map[string]any)
			if !ok {
				continue
			}
			role, _ := obj["role"].(string)
			txt := extractAnyContentText(obj["content"])
			if role == "system" || role == "developer" {
				if txt != "" {
					sysParts = append(sysParts, txt)
				}
			} else if role == "user" && txt != "" {
				lastUser = txt
			}
		}
		if lastUser == "" && len(msgs) > 0 {
			if obj, ok := msgs[len(msgs)-1].(map[string]any); ok {
				lastUser = extractAnyContentText(obj["content"])
			}
		}
	} else if inp, ok := m["input"].(string); ok && inp != "" {
		lastUser = inp
	} else if inpArr, ok := m["input"].([]any); ok {
		for _, item := range inpArr {
			if obj, ok := item.(map[string]any); ok {
				if t := extractAnyContentText(obj["content"]); t != "" {
					lastUser = t
				}
			}
		}
	} else if contents, ok := m["contents"].([]any); ok {
		for _, c := range contents {
			if obj, ok := c.(map[string]any); ok {
				if t := extractGeminiPartsText(obj["parts"]); t != "" {
					lastUser = t
				}
			}
		}
	} else if prompt, ok := m["prompt"].(string); ok && prompt != "" {
		lastUser = prompt
	}

	rec.SystemPrompt = strings.Join(sysParts, "\n\n")
	rec.RequestPreview = lastUser
}

func extractAnyContentText(v any) string {
	switch val := v.(type) {
	case string:
		return val
	case []any:
		var parts []string
		for _, item := range val {
			obj, ok := item.(map[string]any)
			if !ok {
				continue
			}
			if t, ok := obj["text"].(string); ok && t != "" {
				parts = append(parts, t)
			} else if tp, _ := obj["type"].(string); tp == "image_url" || tp == "input_image" {
				parts = append(parts, "[image]")
			} else if tp == "input_audio" {
				parts = append(parts, "[audio]")
			} else if tp == "input_video" || tp == "video_url" {
				parts = append(parts, "[video]")
			}
		}
		return strings.Join(parts, "\n")
	}
	return ""
}

func extractGeminiPartsText(v any) string {
	arr, ok := v.([]any)
	if !ok {
		return ""
	}
	var parts []string
	for _, item := range arr {
		if obj, ok := item.(map[string]any); ok {
			if t, ok := obj["text"].(string); ok && t != "" {
				parts = append(parts, t)
			}
		}
	}
	return strings.Join(parts, "\n")
}

func parseAuditResponse(rawStr, ct string, rec *auditRecord) {
	if strings.TrimSpace(rawStr) == "" {
		return
	}
	isSSE := strings.Contains(strings.ToLower(ct), "text/event-stream") ||
		strings.HasPrefix(strings.TrimSpace(rawStr), "data:") ||
		strings.Contains(rawStr, "\ndata:")

	if isSSE {
		parseAuditSSE(rawStr, rec)
		return
	}

	var m map[string]any
	if err := json.Unmarshal([]byte(rawStr), &m); err != nil {
		if rec.Status >= 400 {
			rec.Error = rawStr
		}
		return
	}

	// Error object
	if errObj, ok := m["error"].(map[string]any); ok {
		if msg, ok := errObj["message"].(string); ok && msg != "" {
			rec.Error = msg
		} else {
			b, _ := json.Marshal(errObj)
			rec.Error = string(b)
		}
	} else if errStr, ok := m["error"].(string); ok && errStr != "" {
		rec.Error = errStr
	}

	if id, ok := m["id"].(string); ok && id != "" {
		rec.RespID = id
	}
	if model, ok := m["model"].(string); ok && model != "" {
		rec.ServedModel = model
	}

	// Usage
	if usage, ok := m["usage"].(map[string]any); ok {
		applyAuditUsage(usage, rec)
	} else if usageMeta, ok := m["usageMetadata"].(map[string]any); ok {
		applyAuditUsage(usageMeta, rec)
	}

	// OpenAI chat completions
	if choices, ok := m["choices"].([]any); ok && len(choices) > 0 {
		if c0, ok := choices[0].(map[string]any); ok {
			if fr, ok := c0["finish_reason"].(string); ok {
				rec.FinishReason = fr
			}
			if msg, ok := c0["message"].(map[string]any); ok {
				rec.Reply = extractAnyContentText(msg["content"])
				if rc, ok := msg["reasoning_content"].(string); ok && rc != "" {
					rec.Reasoning = rc
				} else if th, ok := msg["thinking"].(string); ok && th != "" {
					rec.Reasoning = th
				}
				if tc, ok := msg["tool_calls"].([]any); ok && len(tc) > 0 {
					rec.ToolCallCount = len(tc)
					b, _ := json.Marshal(tc)
					rec.ToolCalls = string(b)
				}
			}
		}
	}

	// Anthropic Messages
	if content, ok := m["content"].([]any); ok && len(content) > 0 && rec.Reply == "" {
		var txt, think []string
		var tcs []any
		for _, item := range content {
			obj, ok := item.(map[string]any)
			if !ok {
				continue
			}
			switch obj["type"] {
			case "text":
				if t, ok := obj["text"].(string); ok {
					txt = append(txt, t)
				}
			case "thinking":
				if t, ok := obj["thinking"].(string); ok {
					think = append(think, t)
				}
			case "tool_use":
				tcs = append(tcs, obj)
			}
		}
		rec.Reply = strings.Join(txt, "\n")
		rec.Reasoning = strings.Join(think, "\n")
		if len(tcs) > 0 {
			rec.ToolCallCount = len(tcs)
			b, _ := json.Marshal(tcs)
			rec.ToolCalls = string(b)
		}
		if sr, ok := m["stop_reason"].(string); ok && sr != "" {
			rec.FinishReason = sr
		}
	}

	// Gemini generateContent
	if cands, ok := m["candidates"].([]any); ok && len(cands) > 0 && rec.Reply == "" {
		if c0, ok := cands[0].(map[string]any); ok {
			if fr, ok := c0["finishReason"].(string); ok {
				rec.FinishReason = fr
			}
			if content, ok := c0["content"].(map[string]any); ok {
				rec.Reply = extractGeminiPartsText(content["parts"])
			}
		}
	}

	// MCP JSON-RPC result
	if res, ok := m["result"].(map[string]any); ok && rec.Reply == "" {
		if content, ok := res["content"].([]any); ok {
			var parts []string
			for _, item := range content {
				obj, ok := item.(map[string]any)
				if !ok {
					continue
				}
				switch obj["type"] {
				case "text":
					if t, ok := obj["text"].(string); ok && t != "" {
						parts = append(parts, t)
					}
				case "image":
					parts = append(parts, "[image]")
				case "audio":
					parts = append(parts, "[audio]")
				case "video":
					parts = append(parts, "[video]")
				}
			}
			rec.Reply = strings.Join(parts, "\n")
		}
	}

	if rec.ReplyPreview == "" {
		rec.ReplyPreview = rec.Reply
		if rec.ReplyPreview == "" && rec.ToolCallCount > 0 {
			rec.ReplyPreview = fmt.Sprintf("[%d tool call(s)]", rec.ToolCallCount)
		}
	}
}

func parseAuditSSE(rawStr string, rec *auditRecord) {
	var replyBuf, reasonBuf strings.Builder
	toolCallsMap := make(map[int]map[string]any)

	lines := strings.Split(rawStr, "\n")
	for _, line := range lines {
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
		if id, ok := chunk["id"].(string); ok && id != "" && rec.RespID == "" {
			rec.RespID = id
		}
		if model, ok := chunk["model"].(string); ok && model != "" {
			rec.ServedModel = model
		}
		if usage, ok := chunk["usage"].(map[string]any); ok {
			applyAuditUsage(usage, rec)
		} else if usageMeta, ok := chunk["usageMetadata"].(map[string]any); ok {
			applyAuditUsage(usageMeta, rec)
		}
		if errObj, ok := chunk["error"].(map[string]any); ok {
			if msg, ok := errObj["message"].(string); ok && msg != "" {
				rec.Error = msg
			}
		}

		if choices, ok := chunk["choices"].([]any); ok {
			for _, ch := range choices {
				c0, ok := ch.(map[string]any)
				if !ok {
					continue
				}
				if fr, ok := c0["finish_reason"].(string); ok && fr != "" {
					rec.FinishReason = fr
				}
				delta, ok := c0["delta"].(map[string]any)
				if !ok {
					continue
				}
				if s, ok := delta["content"].(string); ok && s != "" {
					replyBuf.WriteString(s)
				}
				if s, ok := delta["reasoning_content"].(string); ok && s != "" {
					reasonBuf.WriteString(s)
				}
				if tcs, ok := delta["tool_calls"].([]any); ok {
					for _, tcAny := range tcs {
						tc, ok := tcAny.(map[string]any)
						if !ok {
							continue
						}
						idx := intFromAny(tc["index"])
						cur, exists := toolCallsMap[idx]
						if !exists {
							cur = map[string]any{"index": idx}
							toolCallsMap[idx] = cur
						}
						if id, ok := tc["id"].(string); ok && id != "" {
							cur["id"] = id
						}
						if tp, ok := tc["type"].(string); ok && tp != "" {
							cur["type"] = tp
						}
						if fn, ok := tc["function"].(map[string]any); ok {
							curFn, _ := cur["function"].(map[string]any)
							if curFn == nil {
								curFn = map[string]any{}
								cur["function"] = curFn
							}
							if name, ok := fn["name"].(string); ok && name != "" {
								curFn["name"] = name
							}
							if args, ok := fn["arguments"].(string); ok && args != "" {
								prev, _ := curFn["arguments"].(string)
								curFn["arguments"] = prev + args
							}
						}
					}
				}
			}
		}

		// Gemini SSE
		if cands, ok := chunk["candidates"].([]any); ok && len(cands) > 0 {
			if c0, ok := cands[0].(map[string]any); ok {
				if fr, ok := c0["finishReason"].(string); ok && fr != "" {
					rec.FinishReason = fr
				}
				if content, ok := c0["content"].(map[string]any); ok {
					if t := extractGeminiPartsText(content["parts"]); t != "" {
						replyBuf.WriteString(t)
					}
				}
			}
		}
	}

	rec.Reply = replyBuf.String()
	rec.Reasoning = reasonBuf.String()
	if len(toolCallsMap) > 0 {
		rec.ToolCallCount = len(toolCallsMap)
		arr := make([]map[string]any, 0, len(toolCallsMap))
		for i := 0; i < len(toolCallsMap); i++ {
			if tc, ok := toolCallsMap[i]; ok {
				arr = append(arr, tc)
			}
		}
		if len(arr) > 0 {
			b, _ := json.Marshal(arr)
			rec.ToolCalls = string(b)
		}
	}
	rec.ReplyPreview = rec.Reply
	if rec.ReplyPreview == "" && rec.ToolCallCount > 0 {
		rec.ReplyPreview = fmt.Sprintf("[%d tool call(s)]", rec.ToolCallCount)
	}
}

func intFromAny(v any) int {
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	case int64:
		return int(n)
	}
	return 0
}

func applyAuditUsage(u map[string]any, rec *auditRecord) {
	if v := intFromAny(u["prompt_tokens"]); v > 0 {
		rec.PromptTokens = v
	} else if v := intFromAny(u["input_tokens"]); v > 0 {
		rec.PromptTokens = v
	} else if v := intFromAny(u["promptTokenCount"]); v > 0 {
		rec.PromptTokens = v
	}

	if v := intFromAny(u["output_tokens"]); v > 0 {
		rec.OutputTokens = v
	} else if v := intFromAny(u["completion_tokens"]); v > 0 {
		rec.OutputTokens = v
	} else if v := intFromAny(u["candidatesTokenCount"]); v > 0 {
		rec.OutputTokens = v
	}

	if v := intFromAny(u["total_tokens"]); v > 0 {
		rec.TotalTokens = v
	} else if v := intFromAny(u["totalTokenCount"]); v > 0 {
		rec.TotalTokens = v
	} else if rec.PromptTokens > 0 || rec.OutputTokens > 0 {
		rec.TotalTokens = rec.PromptTokens + rec.OutputTokens
	}

	if v := intFromAny(u["cached_tokens"]); v > 0 {
		rec.CachedTokens = v
	} else if v := intFromAny(u["cachedContentTokenCount"]); v > 0 {
		rec.CachedTokens = v
	} else if details, ok := u["prompt_tokens_details"].(map[string]any); ok {
		if cv := intFromAny(details["cached_tokens"]); cv > 0 {
			rec.CachedTokens = cv
		}
	}

	if v := intFromAny(u["reasoning_tokens"]); v > 0 {
		rec.ReasoningTokens = v
	} else if details, ok := u["completion_tokens_details"].(map[string]any); ok {
		if rv := intFromAny(details["reasoning_tokens"]); rv > 0 {
			rec.ReasoningTokens = rv
		}
	}
}

func classifyAudit(rec *auditRecord) (string, int) {
	failed := 0
	if rec.Status >= 400 || rec.Error != "" {
		failed = 1
	}

	switch {
	case rec.Status == http.StatusTooManyRequests:
		return "rate_limit", 1
	case rec.Status == http.StatusUnauthorized || rec.Status == http.StatusForbidden:
		return "auth_error", 1
	case rec.Status >= 500:
		return "http_5xx", 1
	case rec.Status >= 400:
		return "http_4xx", 1
	case rec.Error != "":
		return "upstream_error", 1
	case rec.FinishReason == "length" || rec.FinishReason == "MAX_TOKENS" || rec.FinishReason == "max_tokens":
		return "truncated", failed
	case rec.Status == http.StatusOK && rec.Method == http.MethodPost &&
		rec.Reply == "" && rec.ToolCallCount == 0 && rec.RawBytes == 0:
		return "empty_reply", failed
	}
	return "", failed
}

func startAuditMaintenance() {
	auditMaintOnce.Do(func() {
		go func() {
			auditMaintain()
			ticker := time.NewTicker(1 * time.Hour)
			defer ticker.Stop()
			for range ticker.C {
				auditMaintain()
			}
		}()
	})
}

func auditMaintain() {
	conn := getAuditDB()
	if conn == nil {
		return
	}

	days := rtCfg().RetentionDays
	if days <= 0 {
		days = 30
	}
	cutoff := time.Now().Unix() - int64(days)*86400
	var maxOldID int64
	_ = conn.QueryRow(`SELECT COALESCE(MAX(id), 0) FROM audit_meta WHERE ts < ?`, cutoff).Scan(&maxOldID)
	if maxOldID > 0 {
		auditDeleteUpTo(conn, maxOldID)
	}

	if maxMBStr := strings.TrimSpace(os.Getenv("AUDIT_MAX_MB")); maxMBStr != "" {
		if maxMB, err := strconv.ParseInt(maxMBStr, 10, 64); err == nil && maxMB > 0 {
			limitBytes := maxMB * 1024 * 1024
			for i := 0; i < 20; i++ {
				if auditDataBytes() <= limitBytes {
					break
				}
				var cutID int64
				_ = conn.QueryRow(`SELECT COALESCE(MAX(id), 0) FROM (SELECT id FROM audit_meta ORDER BY id ASC LIMIT 500)`).Scan(&cutID)
				if cutID == 0 {
					break
				}
				auditDeleteUpTo(conn, cutID)
				_, _ = conn.Exec(`PRAGMA wal_checkpoint(TRUNCATE);`)
			}
		}
	}

	enforceMediaCacheLimit()
}

func auditDeleteUpTo(conn *sql.DB, maxID int64) {
	tx, err := conn.Begin()
	if err != nil {
		return
	}
	defer func() { _ = tx.Rollback() }()
	_, _ = tx.Exec(`DELETE FROM audit_body WHERE id <= ?`, maxID)
	_, _ = tx.Exec(`DELETE FROM audit_meta WHERE id <= ?`, maxID)
	_ = tx.Commit()
}

func auditDataBytes() int64 {
	dir := auditDir()
	var total int64
	for _, name := range []string{"audit.db", "audit.db-wal", "audit.db-shm"} {
		if st, err := os.Stat(filepath.Join(dir, name)); err == nil {
			total += st.Size()
		}
	}
	return total
}

func parseAuditTime(s string) (int64, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, false
	}
	if n, err := strconv.ParseInt(s, 10, 64); err == nil {
		if n > 1e12 {
			n /= 1000
		}
		return n, true
	}
	for _, layout := range []string{
		time.RFC3339,
		"2006-01-02T15:04:05",
		"2006-01-02 15:04:05",
		"2006-01-02",
	} {
		if t, err := time.Parse(layout, s); err == nil {
			return t.Unix(), true
		}
	}
	return 0, false
}
