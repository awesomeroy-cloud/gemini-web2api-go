package app

import (
	"database/sql"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type AuditMetaItem struct {
	ID              int64              `json:"id"`
	TS              int64              `json:"ts"`
	ClientIP        string             `json:"client_ip"`
	Method          string             `json:"method"`
	Path            string             `json:"path"`
	Model           string             `json:"model"`
	ServedModel     string             `json:"served_model"`
	Stream          int                `json:"stream"`
	Status          int                `json:"status"`
	Failed          int                `json:"failed"`
	TTFBMs          int64              `json:"ttfb_ms"`
	FirstDataMs     int64              `json:"first_data_ms"`
	TotalMs         int64              `json:"total_ms"`
	Pings           int                `json:"pings"`
	PromptTokens    int                `json:"prompt_tokens"`
	OutputTokens    int                `json:"output_tokens"`
	ErrorPreview    string             `json:"error_preview"`
	RequestPreview  string             `json:"request_preview"`
	ReplyPreview    string             `json:"reply_preview"`
	RawBytes        int                `json:"raw_bytes"`
	RawTruncated    int                `json:"raw_truncated"`
	V               int                `json:"v"`
	Issue           string             `json:"issue"`
	FinishReason    string             `json:"finish_reason"`
	RespID          string             `json:"resp_id"`
	KeyFP           string             `json:"key_fp"`
	Account         string             `json:"account"`
	Proxy           string             `json:"proxy"`
	Attempts        int                `json:"attempts"`
	UpstreamTTFBMs  int64              `json:"upstream_ttfb_ms"`
	UpstreamMs      int64              `json:"upstream_ms"`
	Chunks          int                `json:"chunks"`
	CachedTokens    int                `json:"cached_tokens"`
	ReasoningTokens int                `json:"reasoning_tokens"`
	TotalTokens     int                `json:"total_tokens"`
	ToolCallCount   int                `json:"tool_call_count"`
	ParamsSummary   string             `json:"params_summary"`
	UserAgent       string             `json:"user_agent"`
	MediaSummary    *AuditMediaSummary `json:"media_summary,omitempty"`
}

func handleAdminAudits(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
	conn := getAuditDB()
	if conn == nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "audit db unavailable"})
		return
	}

	q := r.URL.Query()
	if q.Get("models") == "1" {
		writeJSON(w, http.StatusOK, map[string]any{
			"models":   auditDistinct(conn, "SELECT DISTINCT model FROM audit_meta WHERE model != '' ORDER BY model"),
			"accounts": auditDistinct(conn, "SELECT DISTINCT account FROM audit_meta WHERE account != '' ORDER BY account"),
			"issues":   auditDistinct(conn, "SELECT DISTINCT issue FROM audit_meta WHERE issue != '' ORDER BY issue"),
			"finishes": auditDistinct(conn, "SELECT DISTINCT finish_reason FROM audit_meta WHERE finish_reason != '' ORDER BY finish_reason"),
			"paths":    auditDistinct(conn, "SELECT DISTINCT path FROM audit_meta WHERE path != '' ORDER BY path"),
		})
		return
	}

	limit := 50
	if lStr := q.Get("limit"); lStr != "" {
		if n, err := strconv.Atoi(lStr); err == nil && n > 0 {
			if n > 200 {
				n = 200
			}
			limit = n
		}
	}

	var where []string
	var args []any

	if v := strings.TrimSpace(q.Get("status")); v != "" {
		switch strings.ToLower(v) {
		case "ok", "2xx":
			where = append(where, "m.status >= 200 AND m.status < 300")
		case "4xx":
			where = append(where, "m.status >= 400 AND m.status < 500")
		case "5xx":
			where = append(where, "m.status >= 500")
		case "failed", "err", "error":
			where = append(where, "(m.failed = 1 OR m.status >= 400)")
		default:
			if code, err := strconv.Atoi(v); err == nil {
				where = append(where, "m.status = ?")
				args = append(args, code)
			}
		}
	}
	if v := strings.TrimSpace(q.Get("issue")); v != "" {
		switch v {
		case "any":
			where = append(where, "m.issue != ''")
		case "none":
			where = append(where, "m.issue = ''")
		default:
			where = append(where, "m.issue = ?")
			args = append(args, v)
		}
	}
	if v := strings.TrimSpace(q.Get("model")); v != "" {
		where = append(where, "(m.model = ? OR m.served_model = ?)")
		args = append(args, v, v)
	}
	if v := strings.TrimSpace(q.Get("account")); v != "" {
		where = append(where, "m.account = ?")
		args = append(args, v)
	}
	if v := strings.TrimSpace(q.Get("finish")); v != "" {
		where = append(where, "m.finish_reason = ?")
		args = append(args, v)
	}
	if v := strings.TrimSpace(q.Get("tools")); v != "" {
		if v == "1" || strings.EqualFold(v, "true") {
			where = append(where, "m.tool_call_count > 0")
		} else if v == "0" || strings.EqualFold(v, "false") {
			where = append(where, "m.tool_call_count = 0")
		}
	}
	if v := strings.TrimSpace(q.Get("path")); v != "" {
		where = append(where, "m.path LIKE ?")
		args = append(args, v+"%")
	}
	if v := strings.TrimSpace(q.Get("q")); v != "" {
		like := "%" + v + "%"
		where = append(where, "(m.request_preview LIKE ? OR m.reply_preview LIKE ? OR m.error_preview LIKE ? OR m.model LIKE ? OR m.path LIKE ? OR m.resp_id LIKE ? OR m.client_ip LIKE ?)")
		args = append(args, like, like, like, like, like, like, like)
	}
	if ts, ok := parseAuditTime(q.Get("since")); ok {
		where = append(where, "m.ts >= ?")
		args = append(args, ts)
	}
	if ts, ok := parseAuditTime(q.Get("until")); ok {
		where = append(where, "m.ts <= ?")
		args = append(args, ts)
	}

	var beforeID, afterID int64
	if v := q.Get("before_id"); v != "" {
		beforeID, _ = strconv.ParseInt(v, 10, 64)
	}
	if v := q.Get("after_id"); v != "" {
		afterID, _ = strconv.ParseInt(v, 10, 64)
	}

	// Count total matching filters (excluding keyset cursor)
	countSQL := "SELECT COUNT(*) FROM audit_meta m"
	if len(where) > 0 {
		countSQL += " WHERE " + strings.Join(where, " AND ")
	}
	var total int64
	_ = conn.QueryRow(countSQL, args...).Scan(&total)

	orderBy := "ORDER BY m.id DESC"
	reverse := false
	if beforeID > 0 {
		where = append(where, "m.id < ?")
		args = append(args, beforeID)
	} else if afterID > 0 {
		where = append(where, "m.id > ?")
		args = append(args, afterID)
		orderBy = "ORDER BY m.id ASC"
		reverse = true
	}

	querySQL := `SELECT
		m.id, m.ts, m.client_ip, m.method, m.path, m.model, m.served_model,
		m.stream, m.status, m.failed, m.ttfb_ms, m.first_data_ms, m.total_ms,
		m.pings, m.prompt_tokens, m.output_tokens, m.error_preview,
		m.request_preview, m.reply_preview, m.raw_bytes, m.raw_truncated, m.v,
		m.issue, m.finish_reason, m.resp_id, m.key_fp, m.account, m.proxy,
		m.attempts, m.upstream_ttfb_ms, m.upstream_ms, m.chunks,
		m.cached_tokens, m.reasoning_tokens, m.total_tokens, m.tool_call_count,
		m.params_summary, m.user_agent
	FROM audit_meta m`
	if len(where) > 0 {
		querySQL += " WHERE " + strings.Join(where, " AND ")
	}
	querySQL += " " + orderBy + " LIMIT ?"
	args = append(args, limit+1)

	rows, err := conn.Query(querySQL, args...)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	defer rows.Close()

	var items []AuditMetaItem
	for rows.Next() {
		var it AuditMetaItem
		var tsFloat float64
		if err := rows.Scan(
			&it.ID, &tsFloat, &it.ClientIP, &it.Method, &it.Path, &it.Model, &it.ServedModel,
			&it.Stream, &it.Status, &it.Failed, &it.TTFBMs, &it.FirstDataMs, &it.TotalMs,
			&it.Pings, &it.PromptTokens, &it.OutputTokens, &it.ErrorPreview,
			&it.RequestPreview, &it.ReplyPreview, &it.RawBytes, &it.RawTruncated, &it.V,
			&it.Issue, &it.FinishReason, &it.RespID, &it.KeyFP, &it.Account, &it.Proxy,
			&it.Attempts, &it.UpstreamTTFBMs, &it.UpstreamMs, &it.Chunks,
			&it.CachedTokens, &it.ReasoningTokens, &it.TotalTokens, &it.ToolCallCount,
			&it.ParamsSummary, &it.UserAgent,
		); err != nil {
			continue
		}
		it.TS = int64(tsFloat)
		it.RequestPreview = cleanPreviewBase64(it.RequestPreview)
		it.ReplyPreview = cleanPreviewBase64(it.ReplyPreview)
		items = append(items, it)
	}

	hasMore := false
	if len(items) > limit {
		hasMore = true
		items = items[:limit]
	}
	if reverse {
		for i, j := 0, len(items)-1; i < j; i, j = i+1, j-1 {
			items[i], items[j] = items[j], items[i]
		}
	}
	if items == nil {
		items = []AuditMetaItem{}
	}

	// Lightweight media summary enrichment for items in the page
	for i := range items {
		items[i].MediaSummary = quickAuditMediaSummary(conn, items[i].ID)
	}

	var nextBeforeID int64
	if len(items) > 0 {
		nextBeforeID = items[len(items)-1].ID
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"items":          items,
		"has_more":       hasMore,
		"next_before_id": nextBeforeID,
		"total":          total,
	})
}

func auditDistinct(conn *sql.DB, query string) []string {
	rows, err := conn.Query(query)
	if err != nil {
		return []string{}
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err == nil && s != "" {
			out = append(out, s)
		}
	}
	if out == nil {
		return []string{}
	}
	return out
}

func cleanPreviewBase64(s string) string {
	if s == "" {
		return ""
	}
	if strings.Contains(s, "data:image/") || strings.Contains(s, "data:audio/") || strings.Contains(s, "data:video/") {
		s = reDataURI.ReplaceAllString(s, "[media]")
	}
	return s
}

func quickAuditMediaSummary(conn *sql.DB, id int64) *AuditMediaSummary {
	var reqBody, reply, raw string
	err := conn.QueryRow(`SELECT request_body, reply, raw FROM audit_body WHERE id = ?`, id).Scan(&reqBody, &reply, &raw)
	if err != nil {
		return nil
	}
	reqCount := strings.Count(reqBody, "data:image/") + strings.Count(reqBody, "data:audio/") + strings.Count(reqBody, "data:video/") +
		strings.Count(reqBody, `"inlineData"`) + strings.Count(reqBody, `"inline_data"`) + strings.Count(reqBody, `"input_audio"`)
	resCount := strings.Count(raw, "data:image/") + strings.Count(raw, "data:audio/") + strings.Count(raw, "data:video/") +
		strings.Count(raw, `"b64_json"`) + strings.Count(raw, `"type":"image"`) + strings.Count(raw, `"type": "image"`) +
		strings.Count(raw, `"type":"audio"`) + strings.Count(raw, `"type": "audio"`) +
		strings.Count(raw, `"inlineData"`) + strings.Count(raw, `"inline_data"`)
	if reqCount == 0 && resCount == 0 {
		return nil
	}
	return &AuditMediaSummary{
		ReqCount:   reqCount,
		ResCount:   resCount,
		TotalCount: reqCount + resCount,
	}
}

func handleAdminAuditItem(w http.ResponseWriter, r *http.Request) {
	sub := strings.TrimPrefix(r.URL.Path, "/admin/api/audits/")
	sub = strings.Trim(sub, "/")
	if sub == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "missing audit id"})
		return
	}

	parts := strings.Split(sub, "/")
	id, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil || id <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid audit id"})
		return
	}

	// Route: /admin/api/audits/{id}/media/{side}/{idx}
	if len(parts) == 4 && parts[1] == "media" {
		serveAuditMedia(w, r, id, parts[2], parts[3])
		return
	}
	if len(parts) != 1 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}

	conn := getAuditDB()
	if conn == nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "audit db unavailable"})
		return
	}

	if r.Method == http.MethodDelete {
		_, _ = conn.Exec(`DELETE FROM audit_body WHERE id = ?`, id)
		_, _ = conn.Exec(`DELETE FROM audit_meta WHERE id = ?`, id)
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
		return
	}
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}

	meta, body, err := loadAuditRow(conn, id)
	if err == sql.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "audit not found"})
		return
	} else if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	detail := extractAuditDetail(id, body.RequestBody, body.Reply, body.Raw, body.Reasoning, body.ToolCalls)
	meta.MediaSummary = detail.MediaSummary

	writeJSON(w, http.StatusOK, map[string]any{
		"meta":            meta,
		"id":              meta.ID,
		"ts":              meta.TS,
		"client_ip":       meta.ClientIP,
		"method":          meta.Method,
		"path":            meta.Path,
		"model":           meta.Model,
		"served_model":    meta.ServedModel,
		"stream":          meta.Stream,
		"status":          meta.Status,
		"failed":          meta.Failed,
		"ttfb_ms":         meta.TTFBMs,
		"first_data_ms":   meta.FirstDataMs,
		"total_ms":        meta.TotalMs,
		"pings":           meta.Pings,
		"prompt_tokens":   meta.PromptTokens,
		"output_tokens":   meta.OutputTokens,
		"cached_tokens":   meta.CachedTokens,
		"reasoning_tokens": meta.ReasoningTokens,
		"total_tokens":    meta.TotalTokens,
		"tool_call_count": meta.ToolCallCount,
		"raw_bytes":       meta.RawBytes,
		"raw_truncated":   meta.RawTruncated,
		"issue":           meta.Issue,
		"finish_reason":   meta.FinishReason,
		"resp_id":         meta.RespID,
		"key_fp":          meta.KeyFP,
		"account":         meta.Account,
		"proxy":           meta.Proxy,
		"attempts":        meta.Attempts,
		"chunks":          meta.Chunks,
		"params_summary":  meta.ParamsSummary,
		"user_agent":      meta.UserAgent,
		"error":           body.Error,
		"content_type":    body.ContentType,
		"query":           body.Query,
		"req_headers":     body.ReqHeaders,
		"res_headers":     body.ResHeaders,
		"params":          body.Params,
		"system_prompt":   body.SystemPrompt,
		"tool_calls":      body.ToolCalls,
		"reasoning":       body.Reasoning,
		"request_body":    detail.RequestBody,
		"reply":           detail.Reply,
		"raw":             detail.Raw,
		"req_media":       detail.ReqMedia,
		"res_media":       detail.ResMedia,
		"request_blocks":  detail.RequestBlocks,
		"response_blocks": detail.ResponseBlocks,
		"mcp_info":        detail.MCPInfo,
		"media_summary":   detail.MediaSummary,
	})
}

type auditBodyRow struct {
	Error        string
	RequestBody  string
	Reply        string
	Reasoning    string
	Raw          string
	ContentType  string
	UserAgent    string
	Query        string
	ReqHeaders   string
	ResHeaders   string
	Params       string
	SystemPrompt string
	ToolCalls    string
}

func loadAuditRow(conn *sql.DB, id int64) (*AuditMetaItem, *auditBodyRow, error) {
	var m AuditMetaItem
	var b auditBodyRow
	var tsFloat float64
	err := conn.QueryRow(`SELECT
		m.id, m.ts, m.client_ip, m.method, m.path, m.model, m.served_model,
		m.stream, m.status, m.failed, m.ttfb_ms, m.first_data_ms, m.total_ms,
		m.pings, m.prompt_tokens, m.output_tokens, m.error_preview,
		m.request_preview, m.reply_preview, m.raw_bytes, m.raw_truncated, m.v,
		m.issue, m.finish_reason, m.resp_id, m.key_fp, m.account, m.proxy,
		m.attempts, m.upstream_ttfb_ms, m.upstream_ms, m.chunks,
		m.cached_tokens, m.reasoning_tokens, m.total_tokens, m.tool_call_count,
		m.params_summary, m.user_agent,
		b.error, b.request_body, b.reply, b.reasoning, b.raw, b.content_type,
		b.user_agent, b.query, b.req_headers, b.res_headers, b.params, b.system_prompt, b.tool_calls
	FROM audit_meta m
	JOIN audit_body b ON b.id = m.id
	WHERE m.id = ?`, id).Scan(
		&m.ID, &tsFloat, &m.ClientIP, &m.Method, &m.Path, &m.Model, &m.ServedModel,
		&m.Stream, &m.Status, &m.Failed, &m.TTFBMs, &m.FirstDataMs, &m.TotalMs,
		&m.Pings, &m.PromptTokens, &m.OutputTokens, &m.ErrorPreview,
		&m.RequestPreview, &m.ReplyPreview, &m.RawBytes, &m.RawTruncated, &m.V,
		&m.Issue, &m.FinishReason, &m.RespID, &m.KeyFP, &m.Account, &m.Proxy,
		&m.Attempts, &m.UpstreamTTFBMs, &m.UpstreamMs, &m.Chunks,
		&m.CachedTokens, &m.ReasoningTokens, &m.TotalTokens, &m.ToolCallCount,
		&m.ParamsSummary, &m.UserAgent,
		&b.Error, &b.RequestBody, &b.Reply, &b.Reasoning, &b.Raw, &b.ContentType,
		&b.UserAgent, &b.Query, &b.ReqHeaders, &b.ResHeaders, &b.Params, &b.SystemPrompt, &b.ToolCalls,
	)
	if err != nil {
		return nil, nil, err
	}
	m.TS = int64(tsFloat)
	return &m, &b, nil
}

func serveAuditMedia(w http.ResponseWriter, r *http.Request, id int64, side, idxStr string) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
	if side != "req" && side != "res" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid side"})
		return
	}
	idx, err := strconv.Atoi(idxStr)
	if err != nil || idx < 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid media index"})
		return
	}

	filePath, found := findCachedMediaFile(id, side, idx)
	if !found {
		conn := getAuditDB()
		if conn == nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "audit db unavailable"})
			return
		}
		_, body, err := loadAuditRow(conn, id)
		if err != nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "audit not found"})
			return
		}
		extractAuditDetail(id, body.RequestBody, body.Reply, body.Raw, body.Reasoning, body.ToolCalls)
		filePath, found = findCachedMediaFile(id, side, idx)
		if !found {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "media not found"})
			return
		}
	}

	f, err := os.Open(filePath)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "media file unreadable"})
		return
	}
	defer f.Close()

	st, err := f.Stat()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "stat failed"})
		return
	}

	// Touch mtime for LRU
	now := time.Now()
	_ = os.Chtimes(filePath, now, now)

	// Sniff MIME from extension/magic
	head := make([]byte, 32)
	n, _ := f.Read(head)
	_, _ = f.Seek(0, 0)
	mime, _ := sniffMediaMIME(head[:n], filepath.Ext(filePath))

	w.Header().Set("Content-Type", mime)
	w.Header().Set("Cache-Control", "private, max-age=86400")
	// Inline preview only: explicitly NO Content-Disposition: attachment
	http.ServeContent(w, r, filepath.Base(filePath), st.ModTime(), f)
}

func handleAdminConversations(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"items": []any{},
		"total": 0,
	})
}

var _ = fmt.Sprintf
