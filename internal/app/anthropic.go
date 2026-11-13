package app

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
)

// writeAnthropicError writes an Anthropic-formatted JSON error response.
func writeAnthropicError(w http.ResponseWriter, status int, errType, msg string) {
	writeJSON(w, status, map[string]interface{}{
		"type": "error",
		"error": map[string]string{
			"type":    errType,
			"message": msg,
		},
	})
}

// handleAnthropicMessages implements POST /v1/messages (Anthropic Messages API).
func handleAnthropicMessages(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodOptions:
		handleOptions(w, r)
		return
	case http.MethodPost:
	default:
		writeAnthropicError(w, 405, "invalid_request_error", "method not allowed")
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeAnthropicError(w, 400, "invalid_request_error", err.Error())
		return
	}
	var req map[string]interface{}
	if err := json.Unmarshal(body, &req); err != nil {
		writeAnthropicError(w, 400, "invalid_request_error", "invalid JSON")
		return
	}

	modelInput := getStr(req, "model")
	if modelInput == "" {
		modelInput = rtCfg().DefaultModel
	}
	modelName, modelCfg, err := ResolveModel(modelInput)
	if err != nil {
		writeAnthropicError(w, 400, "invalid_request_error", err.Error())
		return
	}

	openAIMsgs, openAITools, openAIToolChoice := anthropicToOpenAI(req)
	if err := rejectUnsupported(req, openAIMsgs); err != nil {
		writeAnthropicError(w, 400, "invalid_request_error", err.Error())
		return
	}

	images, err := collectImages(openAIMsgs, "")
	if err != nil {
		writeAnthropicError(w, 400, "invalid_request_error", err.Error())
		return
	}

	prompt, latest := messagesToPrompt(openAIMsgs, openAITools, openAIToolChoice)
	if strings.TrimSpace(prompt) == "" && len(images) == 0 {
		writeAnthropicError(w, 400, "invalid_request_error", "empty prompt")
		return
	}

	stream, _ := req["stream"].(bool)
	msgID := "msg_" + randHex(24)
	inTokens := countTokens(prompt)

	var asse *anthropicSSEWriter
	var gate *toolFenceGate
	var onDelta, onReasoning func(string)
	var ka *streamKeepalive
	if stream {
		asse = newAnthropicSSEWriter(w, msgID, modelName, inTokens)
		onReasoning = asse.SendReasoning
		if len(openAITools) == 0 {
			onDelta = asse.SendText
		} else {
			gate = newToolFenceGate(asse.SendText)
			onDelta = gate.Push
		}
		ka = startKeepalive(asse.Ping)
		onDelta, onReasoning = ka.guard(onDelta), ka.guard(onReasoning)
	}

	var text string
	var toolCalls []ToolCall
	var res *StreamResult
	if rtCfg().MultiTurn && len(images) == 0 && modelCfg.Tool == 0 {
		text, toolCalls, res, err = callGeminiConv(openAIMsgs, modelCfg, openAITools, openAIToolChoice, onDelta, onReasoning)
	} else {
		text, toolCalls, res, err = callGemini(prompt, latest, modelCfg, openAITools, images, onDelta, onReasoning)
	}
	ka.Stop()
	if err != nil {
		status, errType := 502, "api_error"
		if _, downgraded := err.(*ModelDowngradedError); downgraded {
			status, errType = 429, "rate_limit_error"
		} else if _, ok := err.(*PromptTooLongError); ok {
			status, errType = 400, "invalid_request_error"
		} else if _, ok := err.(*RateLimitError); ok {
			status, errType = 429, "rate_limit_error"
		}
		recordRequest("anthropic.messages", modelName, prompt, "", res, status, err.Error(), stream)
		if asse != nil && asse.Started() {
			asse.Fail(errType, err.Error())
			return
		}
		writeAnthropicError(w, status, errType, err.Error())
		return
	}

	reasoning := ""
	if res != nil {
		reasoning = res.Reasoning
	}
	stopReason := "end_turn"
	if len(toolCalls) > 0 {
		stopReason = "tool_use"
	}
	outTokens := countTokens(stripDataURLs(text))
	recordRequest("anthropic.messages", modelName, prompt, text, res, 200, "", stream)

	if stream {
		if reasoning != "" {
			emittedR := ""
			if res != nil {
				emittedR = res.EmittedReasoning
			}
			if rest := remainingOf(reasoning, emittedR); rest != "" {
				asse.SendReasoning(rest)
			}
		}
		if rest := remainingOf(text, sentText(res, gate)); rest != "" {
			asse.SendText(rest)
		}
		if len(toolCalls) > 0 {
			asse.SendToolCalls(toolCalls)
		}
		asse.Finish(stopReason, outTokens)
		return
	}

	var content []map[string]interface{}
	if reasoning != "" {
		content = append(content, map[string]interface{}{
			"type":     "thinking",
			"thinking": reasoning,
		})
	}
	if text != "" {
		content = append(content, map[string]interface{}{
			"type": "text",
			"text": text,
		})
	}
	for _, tc := range toolCalls {
		var inputObj interface{}
		if json.Unmarshal([]byte(tc.Function.Arguments), &inputObj) != nil || inputObj == nil {
			inputObj = map[string]interface{}{}
		}
		content = append(content, map[string]interface{}{
			"type":  "tool_use",
			"id":    tc.ID,
			"name":  tc.Function.Name,
			"input": inputObj,
		})
	}
	if content == nil {
		content = []map[string]interface{}{}
	}

	writeJSON(w, 200, map[string]interface{}{
		"id":            msgID,
		"type":          "message",
		"role":          "assistant",
		"model":         modelName,
		"content":       content,
		"stop_reason":   stopReason,
		"stop_sequence": nil,
		"usage": map[string]int{
			"input_tokens":  inTokens,
			"output_tokens": outTokens,
		},
	})
}

func anthropicToOpenAI(req map[string]interface{}) ([]map[string]interface{}, []map[string]interface{}, interface{}) {
	var out []map[string]interface{}

	switch sys := req["system"].(type) {
	case string:
		if strings.TrimSpace(sys) != "" {
			out = append(out, map[string]interface{}{"role": "system", "content": sys})
		}
	case []interface{}:
		var parts []string
		for _, item := range sys {
			if m, ok := item.(map[string]interface{}); ok {
				if t := getStr(m, "text"); t != "" {
					parts = append(parts, t)
				}
			}
		}
		if len(parts) > 0 {
			out = append(out, map[string]interface{}{"role": "system", "content": strings.Join(parts, "\n")})
		}
	}

	msgsRaw, _ := req["messages"].([]interface{})
	for _, raw := range msgsRaw {
		m, ok := raw.(map[string]interface{})
		if !ok {
			continue
		}
		role := getStr(m, "role")
		if role == "" {
			role = "user"
		}
		switch c := m["content"].(type) {
		case string:
			out = append(out, map[string]interface{}{"role": role, "content": c})
		case []interface{}:
			var parts []interface{}
			var toolCalls []interface{}
			var toolResults []map[string]interface{}
			for _, item := range c {
				b, ok := item.(map[string]interface{})
				if !ok {
					continue
				}
				switch getStr(b, "type") {
				case "text":
					parts = append(parts, map[string]interface{}{"type": "text", "text": getStr(b, "text")})
				case "image":
					if src, ok := b["source"].(map[string]interface{}); ok {
						url := ""
						switch getStr(src, "type") {
						case "base64":
							mt := getStr(src, "media_type")
							if mt == "" {
								mt = "image/png"
							}
							if data := getStr(src, "data"); data != "" {
								url = "data:" + mt + ";base64," + data
							}
						case "url":
							url = getStr(src, "url")
						}
						if url != "" {
							parts = append(parts, map[string]interface{}{
								"type":      "image_url",
								"image_url": map[string]interface{}{"url": url},
							})
						}
					}
				case "tool_use":
					argsBytes, _ := json.Marshal(b["input"])
					if len(argsBytes) == 0 || string(argsBytes) == "null" {
						argsBytes = []byte("{}")
					}
					toolCalls = append(toolCalls, map[string]interface{}{
						"id":   getStr(b, "id"),
						"type": "function",
						"function": map[string]interface{}{
							"name":      getStr(b, "name"),
							"arguments": string(argsBytes),
						},
					})
				case "tool_result":
					toolResults = append(toolResults, map[string]interface{}{
						"role":         "tool",
						"tool_call_id": getStr(b, "tool_use_id"),
						"content":      contentToString(b["content"]),
					})
				}
			}
			if len(parts) > 0 || len(toolCalls) > 0 {
				msg := map[string]interface{}{"role": role}
				if len(parts) > 0 {
					msg["content"] = parts
				} else {
					msg["content"] = ""
				}
				if len(toolCalls) > 0 {
					msg["tool_calls"] = toolCalls
				}
				out = append(out, msg)
			}
			for _, tr := range toolResults {
				out = append(out, tr)
			}
		}
	}

	var tools []map[string]interface{}
	if toolsRaw, ok := req["tools"].([]interface{}); ok {
		for _, item := range toolsRaw {
			tm, ok := item.(map[string]interface{})
			if !ok {
				continue
			}
			tools = append(tools, map[string]interface{}{
				"type": "function",
				"function": map[string]interface{}{
					"name":        getStr(tm, "name"),
					"description": getStr(tm, "description"),
					"parameters":  tm["input_schema"],
				},
			})
		}
	}

	var toolChoice interface{}
	if tc, ok := req["tool_choice"].(map[string]interface{}); ok {
		switch getStr(tc, "type") {
		case "any":
			toolChoice = "required"
		case "auto":
			toolChoice = "auto"
		case "none":
			toolChoice = "none"
		case "tool":
			if name := getStr(tc, "name"); name != "" {
				toolChoice = map[string]interface{}{
					"type":     "function",
					"function": map[string]interface{}{"name": name},
				}
			}
		}
	}

	return out, tools, toolChoice
}

type anthropicSSEWriter struct {
	mu       sync.Mutex
	w        http.ResponseWriter
	flusher  http.Flusher
	id       string
	model    string
	inTokens int
	started  bool
	nextIdx  int
	openKind string // "", "thinking", "text"
	openIdx  int
}

func newAnthropicSSEWriter(w http.ResponseWriter, id, model string, inTokens int) *anthropicSSEWriter {
	f, _ := w.(http.Flusher)
	return &anthropicSSEWriter{w: w, flusher: f, id: id, model: model, inTokens: inTokens}
}

func (s *anthropicSSEWriter) Started() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.started
}

func (s *anthropicSSEWriter) emit(event string, payload interface{}) {
	b, _ := json.Marshal(payload)
	fmt.Fprintf(s.w, "event: %s\ndata: %s\n\n", event, b)
	if s.flusher != nil {
		s.flusher.Flush()
	}
}

func (s *anthropicSSEWriter) startLocked() {
	if s.started {
		return
	}
	s.started = true
	s.w.Header().Set("Content-Type", "text/event-stream")
	s.w.Header().Set("Cache-Control", "no-cache")
	s.w.Header().Set("Connection", "keep-alive")
	s.w.Header().Set("X-Accel-Buffering", "no")
	s.w.Header().Set("Access-Control-Allow-Origin", "*")
	s.w.WriteHeader(200)
	s.emit("message_start", map[string]interface{}{
		"type": "message_start",
		"message": map[string]interface{}{
			"id":            s.id,
			"type":          "message",
			"role":          "assistant",
			"content":       []interface{}{},
			"model":         s.model,
			"stop_reason":   nil,
			"stop_sequence": nil,
			"usage": map[string]int{
				"input_tokens":  s.inTokens,
				"output_tokens": 0,
			},
		},
	})
}

func (s *anthropicSSEWriter) closeOpenBlockLocked() {
	if s.openKind == "" {
		return
	}
	s.emit("content_block_stop", map[string]interface{}{
		"type":  "content_block_stop",
		"index": s.openIdx,
	})
	s.openKind = ""
}

func (s *anthropicSSEWriter) SendReasoning(delta string) {
	if delta == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.startLocked()
	if s.openKind != "thinking" {
		s.closeOpenBlockLocked()
		s.openIdx = s.nextIdx
		s.nextIdx++
		s.openKind = "thinking"
		s.emit("content_block_start", map[string]interface{}{
			"type":          "content_block_start",
			"index":         s.openIdx,
			"content_block": map[string]string{"type": "thinking", "thinking": ""},
		})
	}
	s.emit("content_block_delta", map[string]interface{}{
		"type":  "content_block_delta",
		"index": s.openIdx,
		"delta": map[string]string{"type": "thinking_delta", "thinking": delta},
	})
}

func (s *anthropicSSEWriter) SendText(delta string) {
	if delta == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.startLocked()
	if s.openKind != "text" {
		s.closeOpenBlockLocked()
		s.openIdx = s.nextIdx
		s.nextIdx++
		s.openKind = "text"
		s.emit("content_block_start", map[string]interface{}{
			"type":          "content_block_start",
			"index":         s.openIdx,
			"content_block": map[string]string{"type": "text", "text": ""},
		})
	}
	s.emit("content_block_delta", map[string]interface{}{
		"type":  "content_block_delta",
		"index": s.openIdx,
		"delta": map[string]string{"type": "text_delta", "text": delta},
	})
}

func (s *anthropicSSEWriter) SendToolCalls(tcs []ToolCall) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.startLocked()
	s.closeOpenBlockLocked()
	for _, tc := range tcs {
		idx := s.nextIdx
		s.nextIdx++
		s.emit("content_block_start", map[string]interface{}{
			"type":  "content_block_start",
			"index": idx,
			"content_block": map[string]interface{}{
				"type":  "tool_use",
				"id":    tc.ID,
				"name":  tc.Function.Name,
				"input": map[string]interface{}{},
			},
		})
		s.emit("content_block_delta", map[string]interface{}{
			"type":  "content_block_delta",
			"index": idx,
			"delta": map[string]string{"type": "input_json_delta", "partial_json": tc.Function.Arguments},
		})
		s.emit("content_block_stop", map[string]interface{}{
			"type":  "content_block_stop",
			"index": idx,
		})
	}
}

func (s *anthropicSSEWriter) Finish(stopReason string, outTokens int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.startLocked()
	s.closeOpenBlockLocked()
	s.emit("message_delta", map[string]interface{}{
		"type": "message_delta",
		"delta": map[string]interface{}{
			"stop_reason":   stopReason,
			"stop_sequence": nil,
		},
		"usage": map[string]int{"output_tokens": outTokens},
	})
	s.emit("message_stop", map[string]string{"type": "message_stop"})
}

func (s *anthropicSSEWriter) Ping() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.startLocked()
	s.emit("ping", map[string]string{"type": "ping"})
}

func (s *anthropicSSEWriter) Fail(errType, msg string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.startLocked()
	s.emit("error", map[string]interface{}{
		"type":  "error",
		"error": map[string]string{"type": errType, "message": msg},
	})
}
