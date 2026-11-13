package app

import (
	"encoding/json"
	"testing"
)

func TestMCPToolsListAndValidation(t *testing.T) {
	req := &rpcRequest{
		JSONRPC: "2.0",
		ID:      json.RawMessage("1"),
		Method:  "tools/list",
	}
	resp := dispatchMCP(req)
	if resp == nil || resp.Error != nil {
		t.Fatalf("tools/list failed: %+v", resp)
	}
	resMap, ok := resp.Result.(map[string]interface{})
	if !ok {
		t.Fatalf("unexpected result type: %T", resp.Result)
	}
	tools, ok := resMap["tools"].([]interface{})
	if !ok {
		t.Fatalf("unexpected tools type: %T", resMap["tools"])
	}
	names := map[string]bool{}
	for _, item := range tools {
		if m, ok := item.(map[string]interface{}); ok {
			if n, ok := m["name"].(string); ok {
				names[n] = true
			}
		}
	}
	for _, want := range []string{"web_search", "generate_image", "generate_music", "create_video_task", "get_video_status", "generate_canvas", "analyze_media", "ask_gemini"} {
		if !names[want] {
			t.Fatalf("missing tool %q in tools/list: %+v", want, names)
		}
	}

	for _, tc := range []struct {
		name string
		args map[string]interface{}
	}{
		{"generate_canvas", map[string]interface{}{}},
		{"analyze_media", map[string]interface{}{"prompt": "describe"}},
		{"ask_gemini", map[string]interface{}{}},
	} {
		paramsBytes, _ := json.Marshal(map[string]interface{}{"name": tc.name, "arguments": tc.args})
		r := dispatchMCP(&rpcRequest{
			JSONRPC: "2.0",
			ID:      json.RawMessage("2"),
			Method:  "tools/call",
			Params:  paramsBytes,
		})
		if r == nil || r.Error != nil {
			t.Fatalf("%s unexpected rpc error: %+v", tc.name, r)
		}
		out, _ := r.Result.(map[string]interface{})
		if isErr, _ := out["isError"].(bool); !isErr {
			t.Fatalf("%s expected isError=true for missing required args, got %+v", tc.name, out)
		}
	}
}
