package app

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

// temporaryChatEligible 的不变量：仅由 temporary_chat 决定，不再被 multi_turn 压制。
func TestTemporaryChatEligible(t *testing.T) {
	old := rtCfg()
	defer func() { rtMu.Lock(); rtVal = old; rtMu.Unlock() }()

	cases := []struct {
		temp, multi, want bool
	}{
		{false, false, false},
		{true, false, true},
		{true, true, true},
		{false, true, false},
	}
	for _, c := range cases {
		rtMu.Lock()
		rtVal.TemporaryChat = c.temp
		rtVal.MultiTurn = c.multi
		rtMu.Unlock()
		if got := temporaryChatEligible(); got != c.want {
			t.Errorf("temp=%v multi=%v => %v, 期望 %v", c.temp, c.multi, got, c.want)
		}
	}
}

func TestConvBuildInnerTempChat(t *testing.T) {
	mc := ModelConfig{Mode: 1}

	turn0Temp := buildConvInner("hi", mc, &convState{turn: 0}, true)
	if turn0Temp[45] != 1 {
		t.Fatalf("tempChat=true turn=0: inner[45]=%v, want 1", turn0Temp[45])
	}

	turn0Persist := buildConvInner("hi", mc, &convState{turn: 0}, false)
	if turn0Persist[45] != nil {
		t.Fatalf("tempChat=false turn=0: inner[45]=%v, want nil", turn0Persist[45])
	}

	// 多轮续接轮次开启临时对话时，必须同时保留 inner[45]=1 与 inner[2] 续接上下文。
	st := &convState{turn: 2, cid: "c_1", rid: "r_1", rcid: "rc_1", tok26: "tok_26"}
	turn2Temp := buildConvInner("next", mc, st, true)
	if turn2Temp[45] != 1 {
		t.Fatalf("tempChat=true turn=2: inner[45]=%v, want 1", turn2Temp[45])
	}
	ctxSlice, ok := turn2Temp[2].([]interface{})
	if !ok || len(ctxSlice) < 10 || ctxSlice[0] != "c_1" || ctxSlice[1] != "r_1" || ctxSlice[2] != "rc_1" || ctxSlice[9] != "tok_26" {
		t.Fatalf("tempChat=true turn=2: unexpected inner[2]=%#v", turn2Temp[2])
	}

	turn2Persist := buildConvInner("next", mc, st, false)
	if turn2Persist[45] != nil {
		t.Fatalf("tempChat=false turn=2: inner[45]=%v, want nil", turn2Persist[45])
	}
}

func TestConvShouldAutoDelete(t *testing.T) {
	old := rtCfg()
	defer func() { rtMu.Lock(); rtVal = old; rtMu.Unlock() }()

	rtMu.Lock()
	rtVal.AutoDeleteConversation = true
	rtMu.Unlock()

	cases := []struct {
		name string
		st   *convState
		want bool
	}{
		{name: "nil", st: nil, want: false},
		{name: "persistent_login", st: &convState{isLogin: true, temp: false, cid: "c_1", cookie: "SID=1"}, want: true},
		{name: "temp_login", st: &convState{isLogin: true, temp: true, cid: "c_1", cookie: "SID=1"}, want: false},
		{name: "anonymous", st: &convState{isLogin: false, temp: false, cid: "c_1", cookie: "SID=1"}, want: false},
		{name: "empty_cid", st: &convState{isLogin: true, temp: false, cid: "", cookie: "SID=1"}, want: false},
		{name: "empty_cookie", st: &convState{isLogin: true, temp: false, cid: "c_1", cookie: ""}, want: false},
	}
	for _, c := range cases {
		if got := shouldAutoDeleteConv(c.st); got != c.want {
			t.Errorf("%s (AutoDelete=true): got %v, want %v", c.name, got, c.want)
		}
	}

	rtMu.Lock()
	rtVal.AutoDeleteConversation = false
	rtMu.Unlock()
	if got := shouldAutoDeleteConv(&convState{isLogin: true, temp: false, cid: "c_1", cookie: "SID=1"}); got {
		t.Fatalf("AutoDelete=false: got true, want false")
	}
}

func TestConvStoreEvictionAndTemp(t *testing.T) {
	oldRT := rtCfg()
	convMu.Lock()
	oldStore := convStore
	convStore = map[string]*convState{}
	convMu.Unlock()
	t.Cleanup(func() {
		convMu.Lock()
		convStore = oldStore
		convMu.Unlock()
		rtMu.Lock()
		rtVal = oldRT
		rtMu.Unlock()
	})

	rtMu.Lock()
	rtVal.AutoDeleteConversation = true
	rtVal.GeminiBLAuto = false
	rtVal.GeminiBL = "boq_test_bl"
	rtMu.Unlock()

	// 本地 CONNECT 代理陷阱：确认只有非临时(!temp)会话在离开 convStore 时触发 deleteConversation。
	connects := make(chan struct{}, 16)
	trap := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodConnect {
			connects <- struct{}{}
			w.WriteHeader(http.StatusBadGateway)
			return
		}
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer trap.Close()

	expectConnect := func(label string) {
		t.Helper()
		select {
		case <-connects:
		case <-time.After(2 * time.Second):
			t.Fatalf("%s: expected async deleteConversation CONNECT", label)
		}
	}
	expectNoConnect := func(label string) {
		t.Helper()
		select {
		case <-connects:
			t.Fatalf("%s: unexpected async deleteConversation CONNECT", label)
		case <-time.After(40 * time.Millisecond):
		}
	}

	// 1) convGet: 保留未过期条目，清理过期条目；仅非临时会话触发删除。
	convPut("temp_live", &convState{isLogin: true, temp: true, cid: "c_tl", cookie: "SID=tl", proxyURL: trap.URL})
	convPut("temp_exp", &convState{isLogin: true, temp: true, cid: "c_te", cookie: "SID=te", proxyURL: trap.URL})
	convPut("persist_exp", &convState{isLogin: true, temp: false, cid: "c_pe", cookie: "SID=pe", proxyURL: trap.URL})
	convMu.Lock()
	convStore["temp_exp"].updated = time.Now().Add(-convTTL - time.Minute)
	convStore["persist_exp"].updated = time.Now().Add(-convTTL - time.Minute)
	convMu.Unlock()

	gotLive := convGet("temp_live")
	if gotLive == nil || !gotLive.temp {
		t.Fatalf("convGet(temp_live) = %#v, want temp=true", gotLive)
	}
	expectNoConnect("convGet live")

	if got := convGet("temp_exp"); got != nil {
		t.Fatalf("convGet(temp_exp) = %#v, want nil", got)
	}
	expectNoConnect("convGet expired temp")

	if got := convGet("persist_exp"); got != nil {
		t.Fatalf("convGet(persist_exp) = %#v, want nil", got)
	}
	expectConnect("convGet expired persist")

	convMu.Lock()
	if _, ok := convStore["temp_exp"]; ok {
		convMu.Unlock()
		t.Fatalf("temp_exp still in convStore")
	}
	if _, ok := convStore["persist_exp"]; ok {
		convMu.Unlock()
		t.Fatalf("persist_exp still in convStore")
	}
	convMu.Unlock()

	// 2) convDelete: 删掉条目；仅非临时会话触发删除。
	convPut("del_temp", &convState{isLogin: true, temp: true, cid: "c_dt", cookie: "SID=dt", proxyURL: trap.URL})
	convPut("del_persist", &convState{isLogin: true, temp: false, cid: "c_dp", cookie: "SID=dp", proxyURL: trap.URL})

	convDelete("del_temp")
	expectNoConnect("convDelete temp")
	convDelete("del_persist")
	expectConnect("convDelete persist")
	if convGet("del_temp") != nil || convGet("del_persist") != nil {
		t.Fatalf("convDelete did not clean convStore")
	}

	// 3) convPut 超出 convMax：先清过期条目，再淘汰最旧条目；按 st.temp 决定是否触发删除。
	now := time.Now()
	convMu.Lock()
	convStore = map[string]*convState{}
	for i := 0; i < convMax-3; i++ {
		convStore[fmt.Sprintf("fill_%d", i)] = &convState{updated: now}
	}
	convStore["oldest_persist"] = &convState{
		isLogin: true, temp: false, cid: "c_op", cookie: "SID=op", proxyURL: trap.URL,
		updated: now.Add(-10 * time.Minute),
	}
	convStore["exp_temp"] = &convState{
		isLogin: true, temp: true, cid: "c_et", cookie: "SID=et", proxyURL: trap.URL,
		updated: now.Add(-convTTL - time.Minute),
	}
	convStore["exp_persist"] = &convState{
		isLogin: true, temp: false, cid: "c_ep", cookie: "SID=ep", proxyURL: trap.URL,
		updated: now.Add(-convTTL - time.Minute),
	}
	convMu.Unlock()

	convPut("trigger_exp_prune", &convState{})
	expectConnect("convPut prune expired persist")
	expectNoConnect("convPut prune expired temp only once")

	convMu.Lock()
	_, hasExpTemp := convStore["exp_temp"]
	_, hasExpPersist := convStore["exp_persist"]
	_, hasOldestPersist := convStore["oldest_persist"]
	// 补回一条临时老会话和一条普通占位，使 len == convMax，下一步再触发按最旧淘汰。
	convStore["oldest_temp"] = &convState{
		isLogin: true, temp: true, cid: "c_ot", cookie: "SID=ot", proxyURL: trap.URL,
		updated: now.Add(-5 * time.Minute),
	}
	convStore["fill_pad"] = &convState{updated: now}
	convMu.Unlock()
	if hasExpTemp || hasExpPersist {
		t.Fatalf("expired entries not cleaned on convPut: exp_temp=%v exp_persist=%v", hasExpTemp, hasExpPersist)
	}
	if !hasOldestPersist {
		t.Fatalf("oldest_persist should survive when expired pruning brings store <= convMax")
	}

	convPut("trigger_evict_persist", &convState{})
	expectConnect("convPut evict oldest_persist")
	convMu.Lock()
	_, stillHasOldestPersist := convStore["oldest_persist"]
	convMu.Unlock()
	if stillHasOldestPersist {
		t.Fatalf("oldest_persist was not evicted")
	}

	convPut("trigger_evict_temp", &convState{})
	expectNoConnect("convPut evict oldest_temp")
	convMu.Lock()
	_, stillHasOldestTemp := convStore["oldest_temp"]
	convMu.Unlock()
	if stillHasOldestTemp {
		t.Fatalf("oldest_temp was not evicted")
	}
}

func TestDeleteConversationWithXSRF(t *testing.T) {
	oldRT := rtCfg()
	t.Cleanup(func() {
		rtMu.Lock()
		rtVal = oldRT
		rtMu.Unlock()
	})
	rtMu.Lock()
	rtVal.GeminiBLAuto = false
	rtVal.GeminiBL = "boq_test_bl"
	rtMu.Unlock()

	t.Run("empty_xsrf_fetches_token", func(t *testing.T) {
		var getCalls, postCalls int
		var gotEndpoint, gotAT, gotFReq string
		var hasModelHeader bool

		getTok := func(cookie string, authuser int, proxyURL string) (string, error) {
			getCalls++
			if cookie != "SID=c1" || authuser != 1 || proxyURL != "http://proxy:8080" {
				t.Fatalf("unexpected getTok args: %q %d %q", cookie, authuser, proxyURL)
			}
			return "tok_initial", nil
		}
		post := func(endpoint string, headers map[string]string, body []byte, proxyURL string) (int, map[string]string, []byte, error) {
			postCalls++
			gotEndpoint = endpoint
			_, hasModelHeader = headers["x-goog-ext-525001261-jspb"]
			vals, err := url.ParseQuery(string(body))
			if err != nil {
				t.Fatalf("ParseQuery: %v", err)
			}
			gotAT = vals.Get("at")
			gotFReq = vals.Get("f.req")
			return 200, nil, []byte("ok"), nil
		}

		deleteConversationWith("c_123", "SID=c1", "sap1", "", "http://proxy:8080", 1, getTok, post)

		if getCalls != 1 || postCalls != 1 {
			t.Fatalf("getCalls=%d postCalls=%d, want 1, 1", getCalls, postCalls)
		}
		if !strings.HasPrefix(gotEndpoint, "https://gemini.google.com/u/1/_/BardChatUi/data/batchexecute?rpcids=GzXR5e") {
			t.Fatalf("unexpected endpoint: %s", gotEndpoint)
		}
		if hasModelHeader {
			t.Fatalf("x-goog-ext-525001261-jspb should be deleted")
		}
		if gotAT != "tok_initial" {
			t.Fatalf("at=%q, want tok_initial", gotAT)
		}
		if !strings.Contains(gotFReq, "GzXR5e") || !strings.Contains(gotFReq, "c_123") {
			t.Fatalf("unexpected f.req: %s", gotFReq)
		}
	})

	t.Run("400_xsrf_expiry_invalidates_and_retries_once", func(t *testing.T) {
		cookie := "SID=retry_cookie"
		cacheKey := xsrfKey(cookie, 0)
		xsrfMu.Lock()
		xsrfCache[cacheKey] = xsrfEntry{token: "cached_stale", fetched: time.Now()}
		xsrfMu.Unlock()
		t.Cleanup(func() { invalidateXSRF(cookie) })

		var getCalls int
		var seenATs []string
		cacheInvalidatedBeforeRefresh := false

		getTok := func(c string, authuser int, proxyURL string) (string, error) {
			getCalls++
			xsrfMu.Lock()
			_, stillCached := xsrfCache[cacheKey]
			xsrfMu.Unlock()
			cacheInvalidatedBeforeRefresh = !stillCached
			return "fresh_tok", nil
		}
		post := func(endpoint string, headers map[string]string, body []byte, proxyURL string) (int, map[string]string, []byte, error) {
			vals, _ := url.ParseQuery(string(body))
			seenATs = append(seenATs, vals.Get("at"))
			if len(seenATs) == 1 {
				return 400, nil, []byte(`[["er",null,null,400,null,[{"48448350":["xsrf","new",1]}]]]`), nil
			}
			return 200, nil, []byte("ok"), nil
		}

		deleteConversationWith("c_retry", cookie, "sap", "stale_tok", "", 0, getTok, post)

		if !cacheInvalidatedBeforeRefresh {
			t.Fatalf("expected invalidateXSRF before getTok refresh")
		}
		if getCalls != 1 {
			t.Fatalf("getCalls=%d, want 1", getCalls)
		}
		if len(seenATs) != 2 || seenATs[0] != "stale_tok" || seenATs[1] != "fresh_tok" {
			t.Fatalf("seenATs=%v, want [stale_tok fresh_tok]", seenATs)
		}
	})

	t.Run("400_xsrf_retries_only_once", func(t *testing.T) {
		var getCalls, postCalls int
		getTok := func(string, int, string) (string, error) {
			getCalls++
			return "fresh_tok", nil
		}
		post := func(string, map[string]string, []byte, string) (int, map[string]string, []byte, error) {
			postCalls++
			return 400, nil, []byte(`[["er",null,null,400,null,[{"48448350":["xsrf","new",1]}]]]`), nil
		}

		deleteConversationWith("c_once", "SID=once", "sap", "stale_tok", "", 0, getTok, post)

		if getCalls != 1 || postCalls != 2 {
			t.Fatalf("getCalls=%d postCalls=%d, want 1, 2", getCalls, postCalls)
		}
	})

	t.Run("empty_xsrf_plus_400_and_guards", func(t *testing.T) {
		var getCalls, postCalls int
		var seenATs []string
		getTok := func(string, int, string) (string, error) {
			getCalls++
			return fmt.Sprintf("tok_%d", getCalls), nil
		}
		post := func(_ string, _ map[string]string, body []byte, _ string) (int, map[string]string, []byte, error) {
			postCalls++
			vals, _ := url.ParseQuery(string(body))
			seenATs = append(seenATs, vals.Get("at"))
			if postCalls == 1 {
				return 400, nil, []byte(`"xsrf"`), nil
			}
			return 200, nil, []byte("ok"), nil
		}

		deleteConversationWith("", "SID=x", "sap", "", "", 0, getTok, post)
		deleteConversationWith("c_1", "", "sap", "", "", 0, getTok, post)
		if getCalls != 0 || postCalls != 0 {
			t.Fatalf("missing cid/cookie should return early: getCalls=%d postCalls=%d", getCalls, postCalls)
		}

		deleteConversationWith("c_1", "SID=x", "sap", "", "", 0, getTok, post)
		if getCalls != 2 || postCalls != 2 || len(seenATs) != 2 || seenATs[0] != "tok_1" || seenATs[1] != "tok_2" {
			t.Fatalf("unexpected empty+400 flow: getCalls=%d postCalls=%d seenATs=%v", getCalls, postCalls, seenATs)
		}
	})
}
