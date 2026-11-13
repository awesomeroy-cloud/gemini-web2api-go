package app

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type modelsSnapshot struct {
	path     string
	raw      map[string]ModelConfig
	resolved map[string]ModelConfig
	modTime  time.Time
	lastStat time.Time
}

var (
	modelsMu   sync.RWMutex
	modelsSnap modelsSnapshot
)

// initModelsStore initializes the hot-reloadable models.json store alongside configPath.
// If models.json does not exist, it writes the built-in Models map formatted with indent.
func initModelsStore(configPath string) error {
	dir := "."
	if configPath != "" {
		dir = filepath.Dir(configPath)
	}
	path := filepath.Join(dir, "models.json")

	if _, err := os.Stat(path); os.IsNotExist(err) {
		if err := writeModelsFile(path, Models); err != nil {
			return fmt.Errorf("write default models.json: %w", err)
		}
	}

	raw, resolved, mtime, err := loadModelsFromFile(path)
	if err != nil {
		return err
	}

	modelsMu.Lock()
	modelsSnap = modelsSnapshot{
		path:     path,
		raw:      raw,
		resolved: resolved,
		modTime:  mtime,
		lastStat: time.Now(),
	}
	modelsMu.Unlock()
	return nil
}

func writeModelsFile(path string, m map[string]ModelConfig) error {
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	b = append(b, '\n')
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, b, 0644); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return os.WriteFile(path, b, 0644)
	}
	return nil
}

func loadModelsFromFile(path string) (map[string]ModelConfig, map[string]ModelConfig, time.Time, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, nil, time.Time{}, err
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, nil, time.Time{}, err
	}
	var raw map[string]ModelConfig
	if err := json.Unmarshal(b, &raw); err != nil {
		return nil, nil, time.Time{}, fmt.Errorf("parse models.json: %w", err)
	}
	resolved, err := resolveModelAliases(raw)
	if err != nil {
		return nil, nil, time.Time{}, err
	}
	return raw, resolved, info.ModTime(), nil
}

func resolveModelAliases(raw map[string]ModelConfig) (map[string]ModelConfig, error) {
	if len(raw) == 0 {
		return nil, fmt.Errorf("models map cannot be empty")
	}
	out := make(map[string]ModelConfig, len(raw))
	var resolveOne func(name string, stack map[string]bool) (ModelConfig, error)
	resolveOne = func(name string, stack map[string]bool) (ModelConfig, error) {
		if cached, ok := out[name]; ok {
			return cached, nil
		}
		mc, ok := raw[name]
		if !ok {
			return ModelConfig{}, fmt.Errorf("unknown model %q", name)
		}
		if mc.AliasOf == "" {
			if mc.HexID == "" {
				return ModelConfig{}, fmt.Errorf("model %q must specify hex_id or alias_of", name)
			}
			out[name] = mc
			return mc, nil
		}
		if stack[name] {
			return ModelConfig{}, fmt.Errorf("alias_of cycle detected at %q", name)
		}
		stack[name] = true
		target, err := resolveOne(mc.AliasOf, stack)
		delete(stack, name)
		if err != nil {
			return ModelConfig{}, fmt.Errorf("model %q alias_of %q: %w", name, mc.AliasOf, err)
		}
		merged := target
		merged.AliasOf = mc.AliasOf
		if mc.Desc != "" {
			merged.Desc = mc.Desc
		}
		if mc.VideoAspect != 0 {
			merged.VideoAspect = mc.VideoAspect
		}
		out[name] = merged
		return merged, nil
	}

	for name := range raw {
		if _, err := resolveOne(name, map[string]bool{}); err != nil {
			return nil, err
		}
	}
	return out, nil
}

func maybeReloadModels(force bool) {
	modelsMu.RLock()
	path := modelsSnap.path
	lastStat := modelsSnap.lastStat
	curMod := modelsSnap.modTime
	modelsMu.RUnlock()

	if path == "" {
		return
	}
	if !force && time.Since(lastStat) < time.Second {
		return
	}

	info, err := os.Stat(path)
	now := time.Now()
	if err != nil {
		modelsMu.Lock()
		modelsSnap.lastStat = now
		modelsMu.Unlock()
		return
	}
	if !force && info.ModTime().Equal(curMod) {
		modelsMu.Lock()
		modelsSnap.lastStat = now
		modelsMu.Unlock()
		return
	}

	raw, resolved, mtime, err := loadModelsFromFile(path)
	if err != nil {
		logf("[models] reload %s failed (keeping previous snapshot): %v", path, err)
		modelsMu.Lock()
		modelsSnap.lastStat = now
		modelsMu.Unlock()
		return
	}

	modelsMu.Lock()
	modelsSnap.raw = raw
	modelsSnap.resolved = resolved
	modelsSnap.modTime = mtime
	modelsSnap.lastStat = now
	modelsMu.Unlock()
	logf("[models] reloaded %d models from %s", len(resolved), path)
}

// getModels returns the current resolved models map, checking models.json mtime at most once per second.
func getModels() map[string]ModelConfig {
	modelsMu.RLock()
	path := modelsSnap.path
	resolved := modelsSnap.resolved
	lastStat := modelsSnap.lastStat
	modelsMu.RUnlock()

	if path == "" {
		return Models
	}
	if resolved != nil && time.Since(lastStat) < time.Second {
		return resolved
	}
	maybeReloadModels(false)

	modelsMu.RLock()
	resolved = modelsSnap.resolved
	modelsMu.RUnlock()
	if resolved == nil {
		return Models
	}
	return resolved
}

// handleAdminModels handles GET and PUT /admin/api/models.
func handleAdminModels(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		maybeReloadModels(true)
		modelsMu.RLock()
		path := modelsSnap.path
		raw := modelsSnap.raw
		mtime := modelsSnap.modTime
		modelsMu.RUnlock()
		if raw == nil {
			raw = Models
		}
		writeJSON(w, 200, map[string]interface{}{
			"path":   path,
			"models": raw,
			"mtime":  mtime.Unix(),
		})
	case http.MethodPut:
		body, err := io.ReadAll(r.Body)
		if err != nil {
			writeJSON(w, 400, map[string]string{"error": err.Error()})
			return
		}
		var wrapper struct {
			Models map[string]ModelConfig `json:"models"`
		}
		var next map[string]ModelConfig
		if err := json.Unmarshal(body, &wrapper); err == nil && len(wrapper.Models) > 0 {
			next = wrapper.Models
		} else if err := json.Unmarshal(body, &next); err != nil {
			writeJSON(w, 400, map[string]string{"error": "invalid JSON: " + err.Error()})
			return
		}
		resolved, err := resolveModelAliases(next)
		if err != nil {
			writeJSON(w, 400, map[string]string{"error": err.Error()})
			return
		}

		modelsMu.RLock()
		path := modelsSnap.path
		modelsMu.RUnlock()
		if path == "" {
			path = "models.json"
		}
		if err := writeModelsFile(path, next); err != nil {
			writeJSON(w, 500, map[string]string{"error": "write models.json: " + err.Error()})
			return
		}
		info, _ := os.Stat(path)
		mtime := time.Now()
		if info != nil {
			mtime = info.ModTime()
		}
		modelsMu.Lock()
		modelsSnap = modelsSnapshot{
			path:     path,
			raw:      next,
			resolved: resolved,
			modTime:  mtime,
			lastStat: time.Now(),
		}
		modelsMu.Unlock()
		writeJSON(w, 200, map[string]interface{}{
			"ok":     true,
			"path":   path,
			"models": next,
			"mtime":  mtime.Unix(),
		})
	default:
		writeJSON(w, 405, map[string]string{"error": "method not allowed"})
	}
}
