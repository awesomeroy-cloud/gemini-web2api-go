package app

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func wrapMockGeminiRaw(text string) string {
	inner := []interface{}{
		nil,
		[]interface{}{"c_test", "r_test"},
		nil, nil,
		[]interface{}{
			[]interface{}{
				"rc_test",
				[]interface{}{text},
			},
		},
		nil, nil, nil, nil, nil,
		strings.Repeat("x", 180),
	}
	innerJSON, _ := json.Marshal(inner)
	outer := []interface{}{
		[]interface{}{"wrb.fr", nil, string(innerJSON)},
	}
	outerJSON, _ := json.Marshal(outer)
	return fmt.Sprintf(")]}'\n\n%d\n%s\n", len(outerJSON), outerJSON)
}

func TestRefusalDetection(t *testing.T) {
	refusals := []string{
		"I can't assist you with that, as I'm only a language model.",
		"I'm having a hard time fulfilling your request right now.",
		"I encountered an error doing what you asked.",
		"抱歉，我只是一个语言模型，无法完成这个请求。",
	}
	for _, r := range refusals {
		if !isCannedRefusal(r) {
			t.Errorf("expected refusal for %q", r)
		}
	}

	nonRefusals := []string{
		"",
		"Here is the Go code you requested.",
		strings.Repeat("word ", 100) + "I'm having a hard time fulfilling your request",
	}
	for _, okText := range nonRefusals {
		if isCannedRefusal(okText) {
			t.Errorf("unexpected refusal for len=%d", len(okText))
		}
	}
}

func TestRefusalRetry(t *testing.T) {
	rtMu.Lock()
	prev := rtVal
	rtVal.RefusalRetry = true
	rtMu.Unlock()
	defer func() {
		rtMu.Lock()
		rtVal = prev
		rtMu.Unlock()
	}()

	calls := 0
	res, err := withRefusalRetry(ModelConfig{HexID: hexFlash36}, func() (*StreamResult, error) {
		calls++
		if calls < 3 {
			return &StreamResult{Raw: wrapMockGeminiRaw("I'm having a hard time fulfilling your request.")}, nil
		}
		return &StreamResult{Raw: wrapMockGeminiRaw("Actual answer.")}, nil
	})
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if calls != 3 {
		t.Fatalf("expected 3 calls (2 retries), got %d", calls)
	}
	if got := extractResponseText(res.Raw); got != "Actual answer." {
		t.Fatalf("expected 'Actual answer.', got %q", got)
	}

	// Tool models must not retry.
	toolCalls := 0
	_, _ = withRefusalRetry(ModelConfig{HexID: hexFlash36, Tool: toolImage}, func() (*StreamResult, error) {
		toolCalls++
		return &StreamResult{Raw: wrapMockGeminiRaw("I encountered an error doing what you asked.")}, nil
	})
	if toolCalls != 1 {
		t.Fatalf("tool model should not retry, got %d calls", toolCalls)
	}

	// Emitted streams must not retry.
	emittedCalls := 0
	_, _ = withRefusalRetry(ModelConfig{HexID: hexFlash36}, func() (*StreamResult, error) {
		emittedCalls++
		return &StreamResult{
			Emitted: "I'm having",
			Raw:     wrapMockGeminiRaw("I'm having a hard time fulfilling your request."),
		}, nil
	})
	if emittedCalls != 1 {
		t.Fatalf("already-emitted stream should not retry, got %d calls", emittedCalls)
	}
}
