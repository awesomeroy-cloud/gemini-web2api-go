package app

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAuditExtractMagicMIMEAndPCM(t *testing.T) {
	pngBytes := append([]byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1A, '\n'}, bytes.Repeat([]byte{0x01}, 32)...)
	jpgBytes := append([]byte{0xFF, 0xD8, 0xFF, 0xE0}, bytes.Repeat([]byte{0x02}, 32)...)
	mp4Bytes := []byte{0x00, 0x00, 0x00, 0x18, 'f', 't', 'y', 'p', 'm', 'p', '4', '2'}

	if m, ext := sniffMediaMIME(pngBytes, ""); m != "image/png" || ext != ".png" {
		t.Fatalf("png sniff got %s %s", m, ext)
	}
	if m, ext := sniffMediaMIME(jpgBytes, ""); m != "image/jpeg" || ext != ".jpg" {
		t.Fatalf("jpg sniff got %s %s", m, ext)
	}
	if m, ext := sniffMediaMIME(mp4Bytes, ""); m != "video/mp4" || ext != ".mp4" {
		t.Fatalf("mp4 sniff got %s %s", m, ext)
	}

	pcm := bytes.Repeat([]byte{0x10, 0x20}, 200)
	pcmB64 := base64.StdEncoding.EncodeToString(pcm)
	reqJSON := `{"model":"gpt-4o-audio","messages":[{"role":"user","content":[{"type":"input_audio","input_audio":{"data":"` + pcmB64 + `","format":"pcm16"}}]}]}`

	detail := extractAuditDetail(9001, reqJSON, "", "", "", "")
	if len(detail.ReqMedia) != 1 {
		t.Fatalf("expected 1 req media, got %d", len(detail.ReqMedia))
	}
	if detail.ReqMedia[0].MIME != "audio/wav" || detail.ReqMedia[0].Ext != ".wav" {
		t.Fatalf("expected audio/wav .wav, got %s %s", detail.ReqMedia[0].MIME, detail.ReqMedia[0].Ext)
	}
	if !strings.Contains(detail.RequestBody, "[多媒体文件已提取: #0 audio/wav") {
		t.Fatalf("expected sanitized placeholder in request_body, got: %s", detail.RequestBody)
	}
	if strings.Contains(detail.RequestBody, pcmB64) {
		t.Fatalf("raw base64 should be sanitized from request_body")
	}

	cachedPath := filepath.Join(auditMediaDir(), "9001_req_0.wav")
	data, err := os.ReadFile(cachedPath)
	if err != nil {
		t.Fatalf("expected cached wav file at %s: %v", cachedPath, err)
	}
	if len(data) != 44+len(pcm) || !bytes.HasPrefix(data, []byte("RIFF")) {
		t.Fatalf("invalid wrapped wav file: len=%d", len(data))
	}
}

func TestAuditExtractMCPAndTruncatedFallback(t *testing.T) {
	pngBytes := append([]byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1A, '\n'}, bytes.Repeat([]byte{0xAA}, 300)...)
	pngB64 := base64.StdEncoding.EncodeToString(pngBytes)

	reqJSON := `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"generate_image","arguments":{"prompt":"tokyo"}}}`
	resJSON := `{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"done"},{"type":"image","data":"` + pngB64 + `","mimeType":"image/png"}]}}`

	detail := extractAuditDetail(9002, reqJSON, "done", resJSON, "", "")
	if detail.MCPInfo == nil || detail.MCPInfo.ToolName != "generate_image" {
		t.Fatalf("expected mcp_info tool_name=generate_image, got %+v", detail.MCPInfo)
	}
	if len(detail.ResMedia) != 1 || detail.ResMedia[0].MIME != "image/png" {
		t.Fatalf("expected 1 png res_media, got %+v", detail.ResMedia)
	}
	if !strings.Contains(detail.Raw, "/admin/api/audits/9002/media/res/0") {
		t.Fatalf("expected sanitized placeholder in raw: %s", detail.Raw)
	}

	// Ensure NO dl_url or raw_url anywhere in serialized JSON
	b, _ := json.Marshal(detail)
	if strings.Contains(string(b), "dl_url") || strings.Contains(string(b), "raw_url") {
		t.Fatalf("unexpected dl_url or raw_url in detail JSON: %s", string(b))
	}

	// Truncated JSON fallback
	truncRaw := `{"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"image","mimeType":"image/png","data":"` + pngB64
	truncDetail := extractAuditDetail(9003, reqJSON, "", truncRaw, "", "")
	if len(truncDetail.ResMedia) != 1 {
		t.Fatalf("expected truncated fallback to extract 1 media, got %d", len(truncDetail.ResMedia))
	}
}

func TestAuditExtractGeminiInlineAndSSE(t *testing.T) {
	jpgBytes := append([]byte{0xFF, 0xD8, 0xFF, 0xE0}, bytes.Repeat([]byte{0x55}, 300)...)
	jpgB64 := base64.StdEncoding.EncodeToString(jpgBytes)

	geminiRaw := `{"candidates":[{"content":{"parts":[{"text":"here"},{"inlineData":{"mimeType":"image/jpeg","data":"` + jpgB64 + `"}}]}}]}`
	detail := extractAuditDetail(9004, `{}`, "here", geminiRaw, "", "")
	if len(detail.ResMedia) != 1 || detail.ResMedia[0].MIME != "image/jpeg" {
		t.Fatalf("expected 1 jpeg from gemini inlineData, got %+v", detail.ResMedia)
	}

	sseRaw := "data: {\"choices\":[{\"delta\":{\"content\":\"![img](data:image/jpeg;base64," + jpgB64 + ")\"}}]}\n\ndata: [DONE]\n"
	sseDetail := extractAuditDetail(9005, `{}`, "", sseRaw, "", "")
	if len(sseDetail.ResMedia) != 1 || sseDetail.ResMedia[0].MIME != "image/jpeg" {
		t.Fatalf("expected 1 jpeg from SSE markdown data URI, got %+v", sseDetail.ResMedia)
	}
}
