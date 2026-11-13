package app

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func resetModelsSnapForTest() {
	modelsMu.Lock()
	modelsSnap = modelsSnapshot{}
	modelsMu.Unlock()
}

func TestModelsConfigInitAndHotReload(t *testing.T) {
	defer resetModelsSnapForTest()

	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "config.json")
	if err := initModelsStore(cfgPath); err != nil {
		t.Fatalf("initModelsStore: %v", err)
	}

	modelsPath := filepath.Join(dir, "models.json")
	if _, err := os.Stat(modelsPath); err != nil {
		t.Fatalf("expected models.json to be created: %v", err)
	}

	got := getModels()
	if len(got) != len(Models) {
		t.Fatalf("expected %d default models, got %d", len(Models), len(got))
	}
	if _, ok := got["gemini-deep-research"]; !ok {
		t.Fatal("missing gemini-deep-research in default models")
	}
	if _, ok := got["gemini-guided-learning"]; !ok {
		t.Fatal("missing gemini-guided-learning in default models")
	}

	// Write updated models.json with an alias and custom model, bump mtime, force stat check.
	custom := map[string]ModelConfig{
		"gemini-3.6-flash": {HexID: hexFlash36, Mode: 1, Upstream: "3.6 Flash", Desc: "base"},
		"my-alias":         {AliasOf: "gemini-3.6-flash", Desc: "alias desc"},
		"my-custom":        {HexID: "deadbeef", Mode: 1, Desc: "custom"},
	}
	if err := writeModelsFile(modelsPath, custom); err != nil {
		t.Fatalf("writeModelsFile: %v", err)
	}
	future := time.Now().Add(5 * time.Second)
	_ = os.Chtimes(modelsPath, future, future)

	modelsMu.Lock()
	modelsSnap.lastStat = time.Time{}
	modelsMu.Unlock()

	reloaded := getModels()
	if len(reloaded) != 3 {
		t.Fatalf("expected 3 reloaded models, got %d", len(reloaded))
	}
	if reloaded["my-alias"].HexID != hexFlash36 || reloaded["my-alias"].Desc != "alias desc" {
		t.Fatalf("unexpected alias resolution: %+v", reloaded["my-alias"])
	}
	if reloaded["my-custom"].HexID != "deadbeef" {
		t.Fatalf("unexpected custom model: %+v", reloaded["my-custom"])
	}

	// Invalid JSON must keep previous valid snapshot.
	_ = os.WriteFile(modelsPath, []byte("{bad json"), 0644)
	future2 := future.Add(5 * time.Second)
	_ = os.Chtimes(modelsPath, future2, future2)
	modelsMu.Lock()
	modelsSnap.lastStat = time.Time{}
	modelsMu.Unlock()

	kept := getModels()
	if len(kept) != 3 || kept["my-custom"].HexID != "deadbeef" {
		t.Fatalf("invalid json should keep old snapshot, got %d entries", len(kept))
	}
}

func TestModelsConfigAdminAPI(t *testing.T) {
	defer resetModelsSnapForTest()

	dir := t.TempDir()
	if err := initModelsStore(filepath.Join(dir, "config.json")); err != nil {
		t.Fatalf("initModelsStore: %v", err)
	}

	// GET
	req := httptest.NewRequest(http.MethodGet, "/admin/api/models", nil)
	rec := httptest.NewRecorder()
	handleAdminModels(rec, req)
	if rec.Code != 200 {
		t.Fatalf("GET expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var getResp struct {
		Path   string                 `json:"path"`
		Models map[string]ModelConfig `json:"models"`
		Mtime  int64                  `json:"mtime"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &getResp); err != nil {
		t.Fatalf("decode GET: %v", err)
	}
	if getResp.Path == "" || len(getResp.Models) != len(Models) {
		t.Fatalf("unexpected GET payload: path=%q len=%d", getResp.Path, len(getResp.Models))
	}

	// PUT invalid alias cycle -> 400
	badBody, _ := json.Marshal(map[string]ModelConfig{
		"a": {AliasOf: "b"},
		"b": {AliasOf: "a"},
	})
	putBad := httptest.NewRequest(http.MethodPut, "/admin/api/models", bytes.NewReader(badBody))
	recBad := httptest.NewRecorder()
	handleAdminModels(recBad, putBad)
	if recBad.Code != 400 {
		t.Fatalf("PUT cycle expected 400, got %d", recBad.Code)
	}

	// PUT valid -> 200 and immediate reload
	goodBody, _ := json.Marshal(map[string]interface{}{
		"models": map[string]ModelConfig{
			"gemini-3.6-flash": {HexID: hexFlash36, Mode: 1, Desc: "ok"},
			"flash-alias":      {AliasOf: "gemini-3.6-flash"},
		},
	})
	putGood := httptest.NewRequest(http.MethodPut, "/admin/api/models", bytes.NewReader(goodBody))
	recGood := httptest.NewRecorder()
	handleAdminModels(recGood, putGood)
	if recGood.Code != 200 {
		t.Fatalf("PUT good expected 200, got %d: %s", recGood.Code, recGood.Body.String())
	}
	if mc, ok := getModels()["flash-alias"]; !ok || mc.HexID != hexFlash36 {
		t.Fatalf("expected immediate reload of flash-alias, got %+v", mc)
	}
}
