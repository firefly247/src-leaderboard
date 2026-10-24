package io.github.firefly247.srcleaderboard;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.JsResult;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import android.window.OnBackInvokedDispatcher;
import java.util.ArrayList;

public final class MainActivity extends Activity {
    private static final int PICK_FILE = 401;
    private WebView webView;
    private ProgressBar progress;
    private LinearLayout errorPanel;
    private ValueCallback<Uri[]> pendingFiles;
    private boolean loadFailed;

    @Override
    @SuppressLint("SetJavaScriptEnabled") // Only our HTTPS site can navigate inside this WebView.
    public void onCreate(Bundle savedState) {
        super.onCreate(savedState);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(7, 21, 47));
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                android.graphics.Insets safe = insets.getInsets(WindowInsets.Type.systemBars()
                        | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
                return insets;
            });
        } else {
            root.setFitsSystemWindows(true);
        }
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100);
        root.addView(progress, new LinearLayout.LayoutParams(-1, dp(3)));
        FrameLayout content = new FrameLayout(this);
        root.addView(content, new LinearLayout.LayoutParams(-1, 0, 1));
        webView = new WebView(this);
        webView.setBackgroundColor(Color.WHITE);
        content.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        errorPanel = createErrorPanel();
        content.addView(errorPanel, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true); // Required for documents explicitly chosen in the system picker.
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSafeBrowsingEnabled(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setUserAgentString(settings.getUserAgentString() + " SamsungRowingClubAndroid/1.0.0");
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);
        WebView.setWebContentsDebuggingEnabled(false);
        webView.setWebViewClient(new SiteClient());
        webView.setWebChromeClient(new SiteChromeClient());
        webView.setDownloadListener((url, agent, disposition, mime, length) -> openBrowser(url));
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
        }
        if (savedState == null || webView.restoreState(savedState) == null) webView.loadUrl(NavigationPolicy.HOME);
    }

    private LinearLayout createErrorPanel() {
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setGravity(Gravity.CENTER);
        panel.setPadding(dp(28), dp(28), dp(28), dp(28));
        panel.setBackgroundColor(Color.WHITE);
        panel.setVisibility(View.GONE);
        TextView message = new TextView(this);
        message.setText("사이트에 연결하지 못했습니다.\n인터넷 연결을 확인하고 다시 시도해 주세요.");
        message.setTextSize(17);
        message.setGravity(Gravity.CENTER);
        panel.addView(message, new LinearLayout.LayoutParams(-1, -2));
        Button retry = new Button(this);
        retry.setText("다시 시도");
        retry.setOnClickListener(view -> { panel.setVisibility(View.GONE); webView.reload(); });
        panel.addView(retry);
        Button browser = new Button(this);
        browser.setText("브라우저에서 열기");
        browser.setOnClickListener(view -> openBrowser(NavigationPolicy.HOME));
        panel.addView(browser);
        return panel;
    }

    private final class SiteClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            String url = request.getUrl().toString();
            if (!request.isForMainFrame()) return !NavigationPolicy.isInternal(url);
            if (NavigationPolicy.isInternal(url)) return false;
            openBrowser(url);
            return true;
        }

        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
            loadFailed = false;
            errorPanel.setVisibility(View.GONE);
            progress.setVisibility(View.VISIBLE);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            progress.setVisibility(View.GONE);
            if (!loadFailed) errorPanel.setVisibility(View.GONE);
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) showLoadError();
        }

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
            if (request.isForMainFrame() && response.getStatusCode() >= 400) showLoadError();
        }
    }

    private final class SiteChromeClient extends WebChromeClient {
        @Override
        public void onProgressChanged(WebView view, int value) { progress.setProgress(value); }

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (!NavigationPolicy.isInternal(view.getUrl())) return false;
            if (pendingFiles != null) pendingFiles.onReceiveValue(null);
            pendingFiles = callback;
            try {
                Intent intent = params.createIntent();
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                startActivityForResult(intent, PICK_FILE);
            } catch (ActivityNotFoundException error) {
                pendingFiles.onReceiveValue(null);
                pendingFiles = null;
                Toast.makeText(MainActivity.this, "파일 선택 앱을 찾지 못했습니다.", Toast.LENGTH_LONG).show();
            }
            return true;
        }

        @Override
        public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
            if (!NavigationPolicy.isInternal(url)) { result.cancel(); return true; }
            new AlertDialog.Builder(MainActivity.this).setMessage(message)
                    .setPositiveButton("확인", (dialog, which) -> result.confirm())
                    .setOnCancelListener(dialog -> result.cancel()).show();
            return true;
        }

        @Override
        public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
            if (!NavigationPolicy.isInternal(url)) { result.cancel(); return true; }
            new AlertDialog.Builder(MainActivity.this).setMessage(message)
                    .setPositiveButton("확인", (dialog, which) -> result.confirm())
                    .setNegativeButton("취소", (dialog, which) -> result.cancel())
                    .setOnCancelListener(dialog -> result.cancel()).show();
            return true;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != PICK_FILE || pendingFiles == null) return;
        Uri[] selected = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
        ArrayList<Uri> allowed = new ArrayList<>();
        if (selected != null) for (Uri uri : selected) {
            if (uri != null && "content".equals(uri.getScheme())) allowed.add(uri);
        }
        pendingFiles.onReceiveValue(allowed.isEmpty() ? null : allowed.toArray(new Uri[0]));
        pendingFiles = null;
    }

    private void showLoadError() {
        loadFailed = true;
        progress.setVisibility(View.GONE);
        errorPanel.setVisibility(View.VISIBLE);
    }

    private void openBrowser(String url) {
        if (!NavigationPolicy.isBrowserLink(url)) return;
        try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE)); }
        catch (ActivityNotFoundException error) {
            Toast.makeText(this, "브라우저 앱을 찾지 못했습니다.", Toast.LENGTH_LONG).show();
        }
    }

    private void handleBack() {
        if (!NavigationPolicy.isInternal(webView.getUrl())) { navigateBack(); return; }
        webView.evaluateJavascript("(()=>{const dialog=document.querySelector('dialog[open]');if(dialog){dialog.close();return true;}const nav=document.querySelector('#mainNavigation');if(nav&&!nav.hidden){setHeaderMenuOpen(false);return true;}return false;})()",
                result -> { if (!"true".equals(result)) navigateBack(); });
    }

    private void navigateBack() { if (webView.canGoBack()) webView.goBack(); else finish(); }

    @Override
    @SuppressLint("GestureBackNavigation") // Only legacy Android calls this; API 33+ uses the registered OnBackInvokedDispatcher above.
    @SuppressWarnings("deprecation")
    public void onBackPressed() { handleBack(); }

    @Override
    protected void onSaveInstanceState(Bundle out) { webView.saveState(out); super.onSaveInstanceState(out); }

    @Override
    protected void onPause() { webView.onPause(); CookieManager.getInstance().flush(); super.onPause(); }

    @Override
    protected void onResume() { super.onResume(); if (webView != null) webView.onResume(); }

    @Override
    protected void onDestroy() {
        if (pendingFiles != null) pendingFiles.onReceiveValue(null);
        webView.destroy();
        super.onDestroy();
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
}
