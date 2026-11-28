// Analytics for the project page: PostHog, in the same project as the rest of ankush.one and through the same
// first-party proxy (p1.ankush.one), like 3dsDL and sh23ds. The page shares the ankush.one origin, so a visitor
// keeps one id and one replay session across the sites, an opt-out made on ankush.one/privacy holds here too, and
// the `site` property tells the events apart. Nothing loads on localhost or when the browser sends Global Privacy
// Control; window.track() and window.trackError() are safe to call either way. The extension itself sends nothing.
(function () {
  !function(t,e){var o,n,p,r;e.__SV||(window.posthog && window.posthog.__loaded)||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="ki Ci init qi Hi pr Bi zi Di capture calculateEventProperties Qi register register_once register_for_session unregister unregister_for_session Ki getFeatureFlag getFeatureFlagPayload getFeatureFlagResult getAllFeatureFlags isFeatureEnabled reloadFeatureFlags updateFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSurveysLoaded onSessionId getSurveys getActiveMatchingSurveys renderSurvey displaySurvey cancelPendingSurvey canRenderSurvey canRenderSurveyAsync Xi identify setPersonProperties unsetPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset shutdown setIdentity clearIdentity get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException addExceptionStep captureLog startExceptionAutocapture stopExceptionAutocapture loadToolbar get_property getSessionProperty Ji Gi createPersonProfile setInternalOrTestUser Yi Ai rn opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing get_explicit_consent_status is_capturing clear_opt_in_out_capturing Vi debug mr it getPageViewId captureTraceFeedback captureTraceMetric Oi".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);

  var SITE = "newtab-mii-plaza";

  // The stub only gets its capture methods when init() runs, after the page has loaded, so anything
  // tracked before then waits here (with the time it happened) and is passed on by init().
  var early = [];
  function call(method, a, b) {
    if (early) early.push([method, a, b, { timestamp: new Date() }]);
    else if (typeof window.posthog[method] === "function") window.posthog[method](a, b);
  }
  // Analytics events must never break the page.
  window.track = function (name, props) {
    try { call("capture", name, props || {}); } catch (e) {}
  };
  window.trackError = function (err, context) {
    try { call("captureException", err, { context: context }); } catch (e) {}
  };

  var host = location.hostname;
  var off = host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "" ||
    navigator.globalPrivacyControl === true;
  if (off) {
    early = null;
    return;
  }

  function init() {
    window.posthog.init("phc_nBvIMuMmaqQkAXL36Bi6eyTRga0A04klevYFyZf4cfc", {
      api_host: "https://p1.ankush.one",
      ui_host: "https://eu.posthog.com",
      defaults: "2026-05-30",
      // localStorage + cookie, so return visits join up. Every visitor gets a person profile.
      person_profiles: "always",
      capture_pageview: "history_change",
      capture_pageleave: true,
      autocapture: { capture_copied_text: true },
      capture_dead_clicks: true,
      capture_heatmaps: true,
      rageclick: true,
      capture_performance: { network_timing: true, web_vitals: true },
      capture_exceptions: true,
      // Session replay, with console logs and network calls. Headers, bodies and canvas capture also
      // need the matching switches on in the PostHog project's Session replay settings.
      disable_session_recording: false,
      enable_recording_console_log: true,
      session_recording: {
        maskAllInputs: false,
        maskInputOptions: { password: true },
        recordHeaders: true,
        recordBody: true,
        collectFonts: true
      },
      // Set per event rather than with register(): a registered property would be saved in the
      // storage this origin shares and follow the visitor onto the other sites.
      before_send: function (event) {
        if (event && event.properties) event.properties.site = SITE;
        return event;
      }
    });
    var held = early;
    early = null;
    held.forEach(function (c) {
      try { window.posthog[c[0]](c[1], c[2], c[0] === "capture" ? c[3] : undefined); } catch (e) {}
    });
  }

  // The library (~105 KB) waits until the page has loaded and the browser is idle.
  function whenIdle() {
    if (window.requestIdleCallback) requestIdleCallback(init, { timeout: 3000 });
    else setTimeout(init, 1);
  }
  if (document.readyState === "complete") whenIdle();
  else window.addEventListener("load", whenIdle);
})();
