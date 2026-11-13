package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAnthropicToOpenAIConversion(t *testing.T) {
	req := map[string]interface{}{
		"model":  "gemini-3.6-flash",
		"system": []interface{}{map[string]interface{}{"type": "text", "text": "Be concise."}},
		"tools": []interface{}{
			map[string]interface{}{
				"name":         "get_weather",
				"description":  "Fetch weather",
				"input_schema": map[string]interface{}{"type": "object"},
			},
		},
		"tool_choice": map[string]interface{}{"type": "any"},
		"messages": []interface{}{
			map[string]interface{}{
				"role": "user",
				"content": []interface{}{
					map[string]interface{}{"type": "text", "text": "Check Tokyo"},
					map[string]interface{}{
						"type": "image",
						"source": map[string]interface{}{
							"type":       "base64",
							"media_type": "image/png",
							"data":       "AAAA",
						},
					},
				},
			},
			map[string]interface{}{
				"role": "assistant",
				"content": []interface{}{
					map[string]interface{}{
						"type":  "tool_use",
						"id":    "toolu_1",
						"name":  "get_weather",
						"input": map[string]interface{}{"city": "Tokyo"},
					},
				},
			},
			map[string]interface{}{
				"role": "user",
				"content": []interface{}{
					map[string]interface{}{
						"type":        "tool_result",
						"tool_use_id": "toolu_1",
						"content":     "22C",
					},
				},
			},
		},
	}

	msgs, tools, tc := anthropicToOpenAI(req)
	if len(msgs) != 4 {
		t.Fatalf("expected 4 OpenAI messages (system, user, assistant, tool), got %d", len(msgs))
	}
	if msgs[0]["role"] != "system" || msgs[0]["content"] != "Be concise." {
		t.Fatalf("unexpected system msg: %+v", msgs[0])
	}
	if msgs[3]["role"] != "tool" || msgs[3]["tool_call_id"] != "toolu_1" {
		t.Fatalf("unexpected tool msg: %+v", msgs[3])
	}
	if len(tools) != 1 || tc != "required" {
		t.Fatalf("unexpected tools/tool_choice: %+v %v", tools, tc)
	}
}

func TestAnthropicSSEWriter(t *testing.T) {
	rec := httptest.NewRecorder()
	sse := newAnthropicSSEWriter(rec, "msg_123", "gemini-3.6-flash", 10)
	sse.SendReasoning("thinking...")
	sse.SendText("hello ")
	sse.SendToolCalls([]ToolCall{{
		ID:       "call_1",
		Type:     "function",
		Function: ToolCallFunction{Name: "get_weather", Arguments: `{"city":"Tokyo"}`},
	}})
	sse.Finish("tool_use", 25)

	body := rec.Body.String()
	for _, want := range []string{
		"event: message_start",
		"event: content_block_start",
		`"type":"thinking_delta"`,
		`"type":"text_delta"`,
		`"type":"input_json_delta"`,
		"event: content_block_stop",
		"event: message_delta",
		`"stop_reason":"tool_use"`,
		"event: message_stop",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("SSE output missing %q\nbody:\n%s", want, body)
		}
	}
}

func TestAnthropicErrorAndValidation(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/messages", strings.NewReader(`{"model":"nonexistent-model","messages":[]}`))
	handleAnthropicMessages(rec, req)
	if rec.Code != 400 {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
	var errResp struct {
		Type  string `json:"type"`
		Error struct {
			Type    string `json:"type"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &errResp); err != nil {
		t.Fatalf("decode error: %v", err)
	}
	if errResp.Type != "error" || errResp.Error.Type != "invalid_request_error" {
		t.Fatalf("unexpected error shape: %+v", errResp)
	}
}
