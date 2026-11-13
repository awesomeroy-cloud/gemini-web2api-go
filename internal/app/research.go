package app

import (
	"encoding/json"
	"strings"
)

const (
	toolDeepResearch   = 18 // Deep Research (inner[49]=18)
	toolGuidedLearning = 35 // Guided Learning (inner[49]=35)
)

func isResearchTool(tool int) bool {
	return tool == toolDeepResearch || tool == toolGuidedLearning
}

// extractResearchText falls back to scanning inner response frames for the
// longest markdown/text payload when extractResponseText returns empty.
func extractResearchText(raw string) string {
	if text := extractResponseText(raw); text != "" {
		return text
	}
	best := ""
	var walk func(interface{})
	walk = func(o interface{}) {
		switch v := o.(type) {
		case string:
			if len(v) > len(best) && !strings.HasPrefix(v, "http") && strings.Contains(v, " ") {
				best = v
			}
		case []interface{}:
			for _, x := range v {
				walk(x)
			}
		case map[string]interface{}:
			for _, x := range v {
				walk(x)
			}
		}
	}
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "[[") {
			continue
		}
		var arr []interface{}
		if json.Unmarshal([]byte(line), &arr) != nil {
			continue
		}
		for _, it := range arr {
			row, ok := it.([]interface{})
			if !ok || len(row) < 3 {
				continue
			}
			payload, ok := row[2].(string)
			if !ok {
				continue
			}
			var inner interface{}
			if json.Unmarshal([]byte(payload), &inner) == nil {
				walk(inner)
			}
		}
	}
	return best
}
