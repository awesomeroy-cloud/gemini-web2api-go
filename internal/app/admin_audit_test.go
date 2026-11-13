package app

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestAuditMiddlewareAndAdminEndpoints(t *testing.T) {
	conn := getAuditDB()
	if conn == nil {
		t.Fatal("getAuditDB returned nil")
	}

	pngBytes := append([]byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1A, '\n'}, bytes.Repeat([]byte{0x77}, 300)...)
	pngB64 := base64.StdEncoding.EncodeToString(pngBytes)

	handler := auditMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/chat/completions":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"chatcmpl-1","model":"gemini-2.5-flash","choices":[{"finish_reason":"stop","message":{"role":"assistant","content":"hello world"}}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}`))
		case "/mcp":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"image","mimeType":"image/png","data":"` + pngB64 + `"}]}}`))
		case "/v1/models":
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = w.Write([]byte(`{"error":{"message":"rate limited"}}`))
		default:
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("ok"))
		}
	}))

	// 1. Send audited requests
	req1 := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"model":"gemini-2.5-flash","messages":[{"role":"user","content":"hi there"}]}`))
	req1.Header.Set("Authorization", "Bearer sk-test-123456")
	rec1 := httptest.NewRecorder()
	handler.ServeHTTP(rec1, req1)

	req2 := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"generate_image","arguments":{"prompt":"cat"}}}`))
	rec2 := httptest.NewRecorder()
	handler.ServeHTTP(rec2, req2)

	req3 := httptest.NewRequest(http.MethodGet, "/v1/models", nil)
	rec3 := httptest.NewRecorder()
	handler.ServeHTTP(rec3, req3)

	// Non-audited path should not be recorded
	reqSkip := httptest.NewRequest(http.MethodGet, "/admin/api/stats", nil)
	recSkip := httptest.NewRecorder()
	handler.ServeHTTP(recSkip, reqSkip)

	// Wait briefly for async auditWriter
	var count int
	for i := 0; i < 40; i++ {
		_ = conn.QueryRow(`SELECT COUNT(*) FROM audit_meta`).Scan(&count)
		if count >= 3 {
			break
		}
		time.Sleep(25 * time.Millisecond)
	}
	if count < 3 {
		t.Fatalf("expected at least 3 audit rows, got %d", count)
	}

	// 2. Test GET /admin/api/audits?models=1
	rModels := httptest.NewRequest(http.MethodGet, "/admin/api/audits?models=1", nil)
	wModels := httptest.NewRecorder()
	handleAdminAudits(wModels, rModels)
	if wModels.Code != http.StatusOK {
		t.Fatalf("models=1 status=%d", wModels.Code)
	}

	// 3. Test GET /admin/api/audits with filters & pagination
	rList := httptest.NewRequest(http.MethodGet, "/admin/api/audits?limit=2", nil)
	wList := httptest.NewRecorder()
	handleAdminAudits(wList, rList)
	if wList.Code != http.StatusOK {
		t.Fatalf("list status=%d", wList.Code)
	}
	var listResp struct {
		Items        []AuditMetaItem `json:"items"`
		HasMore      bool            `json:"has_more"`
		NextBeforeID int64           `json:"next_before_id"`
		Total        int64           `json:"total"`
	}
	if err := json.Unmarshal(wList.Body.Bytes(), &listResp); err != nil {
		t.Fatalf("unmarshal list: %v", err)
	}
	if len(listResp.Items) != 2 || !listResp.HasMore {
		t.Fatalf("expected 2 items with has_more=true, got len=%d has_more=%v", len(listResp.Items), listResp.HasMore)
	}

	// Filter by issue=rate_limit
	rRate := httptest.NewRequest(http.MethodGet, "/admin/api/audits?issue=rate_limit", nil)
	wRate := httptest.NewRecorder()
	handleAdminAudits(wRate, rRate)
	var rateResp struct {
		Items []AuditMetaItem `json:"items"`
	}
	_ = json.Unmarshal(wRate.Body.Bytes(), &rateResp)
	if len(rateResp.Items) == 0 || rateResp.Items[0].Issue != "rate_limit" {
		t.Fatalf("expected rate_limit item, got %+v", rateResp.Items)
	}

	// 4. Find MCP audit ID and test detail + Range media serving
	var mcpID int64
	if err := conn.QueryRow(`SELECT id FROM audit_meta WHERE path = '/mcp' ORDER BY id DESC LIMIT 1`).Scan(&mcpID); err != nil {
		t.Fatalf("find mcp audit id: %v", err)
	}

	rDetail := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/admin/api/audits/%d", mcpID), nil)
	wDetail := httptest.NewRecorder()
	handleAdminAuditItem(wDetail, rDetail)
	if wDetail.Code != http.StatusOK {
		t.Fatalf("detail status=%d body=%s", wDetail.Code, wDetail.Body.String())
	}
	detailBody := wDetail.Body.String()
	if strings.Contains(detailBody, "dl_url") || strings.Contains(detailBody, "raw_url") {
		t.Fatalf("detail must not contain dl_url or raw_url")
	}
	if !strings.Contains(detailBody, fmt.Sprintf("/admin/api/audits/%d/media/res/0", mcpID)) {
		t.Fatalf("expected media URL in detail response")
	}

	// 5. Test media endpoint with Range header & no Content-Disposition: attachment
	rMedia := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/admin/api/audits/%d/media/res/0", mcpID), nil)
	rMedia.Header.Set("Range", "bytes=0-3")
	wMedia := httptest.NewRecorder()
	handleAdminAuditItem(wMedia, rMedia)
	if wMedia.Code != http.StatusPartialContent {
		t.Fatalf("expected 206 Partial Content for Range request, got %d", wMedia.Code)
	}
	if cd := wMedia.Header().Get("Content-Disposition"); strings.Contains(strings.ToLower(cd), "attachment") {
		t.Fatalf("must not set Content-Disposition: attachment, got %q", cd)
	}
	if !bytes.Equal(wMedia.Body.Bytes(), []byte{0x89, 'P', 'N', 'G'}) {
		t.Fatalf("unexpected range bytes: %v", wMedia.Body.Bytes())
	}

	// 6. Test /admin/api/conversations
	rConv := httptest.NewRequest(http.MethodGet, "/admin/api/conversations", nil)
	wConv := httptest.NewRecorder()
	handleAdminConversations(wConv, rConv)
	if wConv.Code != http.StatusOK {
		t.Fatalf("conversations status=%d", wConv.Code)
	}

	// 7. Regression: existing audit.db stores ts as REAL (e.g. 1794578832.987)
	res, err := conn.Exec(`INSERT INTO audit_meta (ts, method, path, model, status) VALUES (1794578832.987, 'POST', '/v1/chat/completions', 'gemini-3.6-flash', 200)`)
	if err != nil {
		t.Fatalf("insert real ts: %v", err)
	}
	realID, _ := res.LastInsertId()
	if _, err := conn.Exec(`INSERT INTO audit_body (id, request_body, reply) VALUES (?, '{}', 'ok')`, realID); err != nil {
		t.Fatalf("insert real ts body: %v", err)
	}

	rRealList := httptest.NewRequest(http.MethodGet, "/admin/api/audits?limit=1", nil)
	wRealList := httptest.NewRecorder()
	handleAdminAudits(wRealList, rRealList)
	if wRealList.Code != http.StatusOK {
		t.Fatalf("real ts list status=%d", wRealList.Code)
	}
	var realListResp struct {
		Items []AuditMetaItem `json:"items"`
	}
	_ = json.Unmarshal(wRealList.Body.Bytes(), &realListResp)
	if len(realListResp.Items) != 1 || realListResp.Items[0].ID != realID || realListResp.Items[0].TS != 1794578832 {
		t.Fatalf("expected real ts item id=%d ts=1794578832, got %+v", realID, realListResp.Items)
	}

	rRealDetail := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/admin/api/audits/%d", realID), nil)
	wRealDetail := httptest.NewRecorder()
	handleAdminAuditItem(wRealDetail, rRealDetail)
	if wRealDetail.Code != http.StatusOK {
		t.Fatalf("real ts detail status=%d body=%s", wRealDetail.Code, wRealDetail.Body.String())
	}
}
