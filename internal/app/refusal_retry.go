package app

import "strings"

const maxRefusalRetries = 2

var cannedRefusalPhrases = []string{
	"i can't assist you with that, as i'm only a language model",
	"i'm having a hard time fulfilling your request",
	"i encountered an error doing what you asked",
	"我只是一个语言模型",
	"as a language model, i",
	"i'm unable to help with that",
	"sorry, i can't help with that",
	"i cannot assist with that",
	"i can't help with that",
}

// isCannedRefusal reports whether text is a short canned upstream refusal.
func isCannedRefusal(text string) bool {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" || len(trimmed) > 350 {
		return false
	}
	lower := strings.ToLower(trimmed)
	for _, p := range cannedRefusalPhrases {
		if strings.Contains(lower, p) {
			return true
		}
	}
	return false
}

// withRefusalRetry retries non-tool requests up to 2 times on a fresh session
// when RefusalRetry is enabled and the upstream returns a short canned refusal
// before any delta has been emitted to the caller.
func withRefusalRetry(mc ModelConfig, call func() (*StreamResult, error)) (*StreamResult, error) {
	if !rtCfg().RefusalRetry || mc.Tool > 0 {
		return call()
	}
	for attempt := 0; attempt <= maxRefusalRetries; attempt++ {
		res, err := call()
		if err != nil || res == nil || res.Emitted != "" {
			return res, err
		}
		if !isCannedRefusal(extractResponseText(res.Raw)) || attempt == maxRefusalRetries {
			return res, err
		}
		logf("[refusal] canned refusal detected (attempt %d/%d), retrying on fresh session", attempt+1, maxRefusalRetries+1)
	}
	return nil, nil
}
