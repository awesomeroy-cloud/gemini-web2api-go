package app

import (
	"fmt"
	"strings"
)

func generateCanvasToolDef() map[string]interface{} {
	return map[string]interface{}{
		"name":        "generate_canvas",
		"description": "Generate an interactive HTML document, UI prototype, or visualization with Google Gemini Canvas.",
		"inputSchema": map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"prompt": map[string]interface{}{
					"type":        "string",
					"description": "Description of the interactive HTML page, chart, or tool to generate.",
				},
			},
			"required": []interface{}{"prompt"},
		},
	}
}

func analyzeMediaToolDef() map[string]interface{} {
	return map[string]interface{}{
		"name":        "analyze_media",
		"description": "Analyze images or videos via Google Gemini (OCR, UI inspection, diagram reading, video summary). Requires a signed-in cookie.",
		"inputSchema": map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"prompt": map[string]interface{}{
					"type":        "string",
					"description": "Question or analysis instruction for the provided media.",
				},
				"media_urls": map[string]interface{}{
					"type":        "array",
					"items":       map[string]interface{}{"type": "string"},
					"description": "Image or video inputs as data: URLs or http(s) links.",
				},
				"model": map[string]interface{}{
					"type":        "string",
					"description": "Optional Gemini model id (defaults to gemini-4-hydrogen).",
				},
			},
			"required": []interface{}{"prompt", "media_urls"},
		},
	}
}

func askGeminiToolDef() map[string]interface{} {
	return map[string]interface{}{
		"name":        "ask_gemini",
		"description": "Delegate complex reasoning, analysis, or review to a specified Google Gemini model (defaults to gemini-4-argon-thinking).",
		"inputSchema": map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"prompt": map[string]interface{}{
					"type":        "string",
					"description": "The prompt or question for Gemini.",
				},
				"model": map[string]interface{}{
					"type":        "string",
					"description": "Optional Gemini model id (e.g. gemini-4-argon-thinking, gemini-4-hydrogen, gemini-3.1-pro-thinking).",
				},
				"include_thinking": map[string]interface{}{
					"type":        "boolean",
					"description": "Whether to include captured reasoning output when available.",
				},
			},
			"required": []interface{}{"prompt"},
		},
	}
}

func mcpTextResult(text string) map[string]interface{} {
	return map[string]interface{}{
		"content": []interface{}{map[string]interface{}{"type": "text", "text": text}},
	}
}

func mcpGenerateCanvas(prompt string) (string, error) {
	_, mc, err := resolveModel("gemini-canvas")
	if err != nil {
		return "", err
	}
	text, _, _, err := callGemini(prompt, prompt, mc, nil, nil, nil, nil)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(text) == "" {
		return "", fmt.Errorf("上游没有返回内容")
	}
	return text, nil
}

func mcpAnalyzeMedia(args map[string]interface{}) (string, error) {
	prompt := strings.TrimSpace(getStr(args, "prompt"))
	if prompt == "" {
		return "", fmt.Errorf("prompt 不能为空")
	}
	urls := mcpStrings(args["media_urls"])
	if len(urls) == 0 {
		urls = mcpStrings(args["image_urls"])
	}
	if len(urls) == 0 {
		return "", fmt.Errorf("media_urls 不能为空")
	}
	modelName := strings.TrimSpace(getStr(args, "model"))
	if modelName == "" {
		modelName = "gemini-4-hydrogen"
	}
	_, mc, err := resolveModel(modelName)
	if err != nil {
		return "", err
	}
	var uploads []pendingUpload
	for i, src := range urls {
		up, err := materializeImage(src, "", i+1)
		if err != nil {
			return "", err
		}
		uploads = append(uploads, up)
	}
	text, _, _, err := callGemini(prompt, prompt, mc, nil, uploads, nil, nil)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(text) == "" {
		return "", fmt.Errorf("上游没有返回内容")
	}
	return text, nil
}

func mcpAskGemini(args map[string]interface{}) (string, error) {
	prompt := strings.TrimSpace(getStr(args, "prompt"))
	if prompt == "" {
		return "", fmt.Errorf("prompt 不能为空")
	}
	modelName := strings.TrimSpace(getStr(args, "model"))
	if modelName == "" {
		if hasCookie() {
			modelName = "gemini-4-argon-thinking"
		} else {
			modelName = rtCfg().DefaultModel
		}
	}
	_, mc, err := resolveModel(modelName)
	if err != nil {
		return "", err
	}
	includeThinking, _ := args["include_thinking"].(bool)
	var thinking strings.Builder
	var onReasoning func(string)
	if includeThinking {
		onReasoning = func(delta string) { thinking.WriteString(delta) }
	}
	text, _, _, err := callGemini(prompt, prompt, mc, nil, nil, nil, onReasoning)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(text) == "" && thinking.Len() == 0 {
		return "", fmt.Errorf("上游没有返回内容")
	}
	if includeThinking && thinking.Len() > 0 {
		return "<thinking>\n" + strings.TrimSpace(thinking.String()) + "\n</thinking>\n\n" + text, nil
	}
	return text, nil
}
