package app

import (
	"io/fs"
	"net/http"
	"net/http/httptest"
	"reflect"
	"regexp"
	"strings"
	"testing"
)

func TestAdminUIServing(t *testing.T) {
	// /admin must issue a relative 301 redirect so reverse-proxy subpaths stay intact.
	reqRedir := httptest.NewRequest(http.MethodGet, "/admin", nil)
	recRedir := httptest.NewRecorder()
	handleAdminUI(recRedir, reqRedir)
	if recRedir.Code != http.StatusMovedPermanently {
		t.Fatalf("GET /admin status = %d, want 301", recRedir.Code)
	}
	if loc := recRedir.Header().Get("Location"); loc != "admin/" {
		t.Fatalf("GET /admin Location = %q, want %q", loc, "admin/")
	}

	assets := []struct {
		path string
		ct   string
	}{
		{"/admin/", "text/html; charset=utf-8"},
		{"/admin/styles.css", "text/css; charset=utf-8"},
		{"/admin/app.js", "text/javascript; charset=utf-8"},
		{"/admin/api.js", "text/javascript; charset=utf-8"},
		{"/admin/i18n.js", "text/javascript; charset=utf-8"},
		{"/admin/ui.js", "text/javascript; charset=utf-8"},
		{"/admin/views-overview.js", "text/javascript; charset=utf-8"},
		{"/admin/views-traffic.js", "text/javascript; charset=utf-8"},
		{"/admin/views-accounts.js", "text/javascript; charset=utf-8"},
		{"/admin/views-egress.js", "text/javascript; charset=utf-8"},
		{"/admin/views-models.js", "text/javascript; charset=utf-8"},
		{"/admin/views-config.js", "text/javascript; charset=utf-8"},
		{"/admin/chart.umd.min.js", "text/javascript; charset=utf-8"},
	}

	for _, tc := range assets {
		req := httptest.NewRequest(http.MethodGet, tc.path, nil)
		rec := httptest.NewRecorder()
		handleAdminUI(rec, req)
		if rec.Code != http.StatusOK {
			t.Errorf("GET %s status = %d, want 200", tc.path, rec.Code)
			continue
		}
		if gotCT := rec.Header().Get("Content-Type"); gotCT != tc.ct {
			t.Errorf("GET %s Content-Type = %q, want %q", tc.path, gotCT, tc.ct)
		}
		if rec.Body.Len() == 0 {
			t.Errorf("GET %s returned empty body", tc.path)
		}
	}

	reqMissing := httptest.NewRequest(http.MethodGet, "/admin/does-not-exist.js", nil)
	recMissing := httptest.NewRecorder()
	handleAdminUI(recMissing, reqMissing)
	if recMissing.Code != http.StatusNotFound {
		t.Errorf("GET /admin/does-not-exist.js status = %d, want 404", recMissing.Code)
	}
}

func TestAdminUIModernHTML(t *testing.T) {
	raw, err := fs.ReadFile(adminUIFS, "admin_ui/index.html")
	if err != nil {
		t.Fatalf("read admin_ui/index.html: %v", err)
	}
	html := string(raw)

	for _, needle := range []string{
		`<!DOCTYPE html>`,
		`<meta name="color-scheme" content="light dark">`,
		`localStorage.getItem("color-scheme")`,
		`<dialog`,
		`closedby="any"`,
		`<search`,
		`href="styles.css"`,
		`src="chart.umd.min.js"`,
		`src="app.js"`,
	} {
		if !strings.Contains(html, needle) {
			t.Errorf("index.html missing required markup %q", needle)
		}
	}

	for _, forbidden := range []string{
		`role="dialog"`,
		`aria-modal`,
	} {
		if strings.Contains(html, forbidden) {
			t.Errorf("index.html must not contain %q on native <dialog>", forbidden)
		}
	}
}

func TestAdminUIRuntimeConfigCoverage(t *testing.T) {
	raw, err := fs.ReadFile(adminUIFS, "admin_ui/views-config.js")
	if err != nil {
		t.Fatalf("read admin_ui/views-config.js: %v", err)
	}
	src := string(raw)

	rt := reflect.TypeOf(RuntimeConfig{})
	for i := 0; i < rt.NumField(); i++ {
		f := rt.Field(i)
		tag := strings.Split(f.Tag.Get("json"), ",")[0]
		if tag == "" || tag == "-" {
			continue
		}
		if !strings.Contains(src, tag) {
			t.Errorf("RuntimeConfig field %s (json:%q) missing from admin_ui/views-config.js", f.Name, tag)
		}
	}
}

func TestAdminUIAPIRouteCoverage(t *testing.T) {
	entries, err := fs.ReadDir(adminUIFS, "admin_ui")
	if err != nil {
		t.Fatalf("readdir admin_ui: %v", err)
	}

	var jsBuf strings.Builder
	var apiJS string
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".js") {
			continue
		}
		b, err := fs.ReadFile(adminUIFS, "admin_ui/"+e.Name())
		if err != nil {
			t.Fatalf("read admin_ui/%s: %v", e.Name(), err)
		}
		if e.Name() == "api.js" {
			apiJS = string(b)
		}
		jsBuf.WriteString("\n// ")
		jsBuf.WriteString(e.Name())
		jsBuf.WriteByte('\n')
		jsBuf.Write(b)
	}
	allJS := jsBuf.String()

	if !strings.Contains(apiJS, "api/${clean}") {
		t.Fatalf("api.js missing api/${clean} prefix builder")
	}

	routes := []string{
		"api/stats",
		"api/timeseries",
		"api/audits",
		"api/requests",
		"api/conversations",
		"api/cookies",
		"api/video-quota",
		"api/proxies",
		"api/usage",
		"api/test",
		"api/models",
		"api/config",
		"api/apikey",
		"api/login",
		"api/logout",
	}

	for _, fullRoute := range routes {
		suffix := strings.TrimPrefix(fullRoute, "api/")
		pat := regexp.MustCompile(`(?:` + regexp.QuoteMeta(fullRoute) + `|apiFetch\(\s*['"` + "`" + `]/?` + regexp.QuoteMeta(suffix) + `['"` + "`" + `?/#])`)
		if !pat.MatchString(allJS) {
			t.Errorf("admin API route %q is not referenced across admin_ui/*.js", fullRoute)
		}
	}
}

func TestAdminUIUnifiedDesignSystem(t *testing.T) {
	uiJS, err := fs.ReadFile(adminUIFS, "admin_ui/ui.js")
	if err != nil {
		t.Fatalf("read embedded admin_ui/ui.js: %v", err)
	}
	if len(uiJS) == 0 {
		t.Fatal("admin_ui/ui.js is empty")
	}

	htmlBytes, err := fs.ReadFile(adminUIFS, "admin_ui/index.html")
	if err != nil {
		t.Fatalf("read admin_ui/index.html: %v", err)
	}
	reHTMLStyle := regexp.MustCompile(`(?i)\bstyle\s*=`)
	if reHTMLStyle.Match(htmlBytes) {
		t.Errorf("admin_ui/index.html must not contain inline style= attributes")
	}

	entries, err := fs.ReadDir(adminUIFS, "admin_ui")
	if err != nil {
		t.Fatalf("readdir admin_ui: %v", err)
	}

	reJSStyleProp := regexp.MustCompile(`\.style(?:\.|\[)`)
	reJSStyleAttr := regexp.MustCompile(`(?i)(?:<[^>]*\bstyle\s*=|setAttribute\s*\(\s*['"]style['"])`)

	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".js") || e.Name() == "chart.umd.min.js" {
			continue
		}
		b, err := fs.ReadFile(adminUIFS, "admin_ui/"+e.Name())
		if err != nil {
			t.Fatalf("read admin_ui/%s: %v", e.Name(), err)
		}
		if reJSStyleProp.Match(b) {
			t.Errorf("admin_ui/%s must not write .style.* properties", e.Name())
		}
		if reJSStyleAttr.Match(b) {
			t.Errorf("admin_ui/%s must not emit inline style= attributes", e.Name())
		}
	}
}
