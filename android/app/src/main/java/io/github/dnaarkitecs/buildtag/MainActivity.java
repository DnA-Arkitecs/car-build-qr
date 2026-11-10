package io.github.dnaarkitecs.buildtag;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Runs the Build Tag page from files packed in the app. The page is served
 * under https://appassets.androidplatform.net/ (Android's reserved address
 * for app files), so it gets a secure origin, ES modules load, and nothing
 * comes from the network. Every other address opens in the phone's browser.
 * The page reaches the phone through window.BuildTagApp: save a file to
 * Downloads, print, and copy to the clipboard.
 */
public class MainActivity extends Activity {
    static final String HOST = "appassets.androidplatform.net";
    static final String HOME = "https://" + HOST + "/index.html";
    static final int PICK_FILE = 1;
    static final Map<String, String> TYPES = new HashMap<>();
    static final Set<String> SAVE_TYPES = new HashSet<>(Arrays.asList("image/svg+xml", "image/png", "application/json"));
    static {
        TYPES.put("html", "text/html");
        TYPES.put("css", "text/css");
        TYPES.put("js", "text/javascript");
        TYPES.put("svg", "image/svg+xml");
        TYPES.put("png", "image/png");
        TYPES.put("json", "application/json");
    }

    WebView web;
    ValueCallback<Uri[]> pendingPick;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);        // the owner's build is kept in localStorage
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportMultipleWindows(false);  // target=_blank stays in this view
        web.addJavascriptInterface(new Bridge(), "BuildTagApp");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                return HOST.equals(u.getHost()) ? asset(u.getPath()) : null;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (HOST.equals(u.getHost())) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (ActivityNotFoundException e) {
                    toast("No app can open that link.");
                }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (pendingPick != null) pendingPick.onReceiveValue(null);
                pendingPick = callback;
                try {
                    startActivityForResult(params.createIntent(), PICK_FILE);
                } catch (ActivityNotFoundException e) {
                    pendingPick = null;
                    return false;
                }
                return true;
            }
        });
        if (state == null || web.restoreState(state) == null) web.loadUrl(HOME);
    }

    /** Serves a packed file, refusing anything outside the web folder. */
    WebResourceResponse asset(String path) {
        if (path == null || path.equals("/") || path.isEmpty()) path = "/index.html";
        String name = path.substring(1);
        String ext = name.contains(".") ? name.substring(name.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT) : "";
        String type = TYPES.get(ext);
        if (type == null || name.contains("..") || name.startsWith("/")) return notFound();
        try {
            InputStream in = getAssets().open("web/" + name);
            boolean text = type.startsWith("text/") || type.endsWith("json") || type.endsWith("xml");
            WebResourceResponse r = new WebResourceResponse(type, text ? "utf-8" : null, in);
            r.setResponseHeaders(Collections.singletonMap("Cache-Control", "no-store"));
            return r;
        } catch (Exception e) {
            return notFound();
        }
    }

    static WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
    }

    void toast(String text) {
        runOnUiThread(() -> Toast.makeText(this, text, Toast.LENGTH_LONG).show());
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == PICK_FILE && pendingPick != null) {
            pendingPick.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            pendingPick = null;
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    /** What the page may ask of the phone. Only this app's own page is ever loaded here. */
    class Bridge {
        @JavascriptInterface
        public String saveFile(String filename, String type, String base64) {
            try {
                if (!SAVE_TYPES.contains(type)) return "that kind of file is not saved";
                String name = filename.replaceAll("[^A-Za-z0-9._-]", "-");
                if (name.length() > 80) name = name.substring(name.length() - 80);
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                ContentValues v = new ContentValues();
                v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                v.put(MediaStore.MediaColumns.MIME_TYPE, type);
                v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Build Tag");
                Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                if (uri == null) return "the phone refused the file";
                try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                    out.write(bytes);
                }
                toast("Saved to Downloads/Build Tag: " + name);
                return "ok";
            } catch (Exception e) {
                return "the phone could not save it";
            }
        }

        @JavascriptInterface
        public void print(String title) {
            runOnUiThread(() -> {
                PrintManager pm = (PrintManager) getSystemService(PRINT_SERVICE);
                String job = (title == null || title.isEmpty()) ? "Build Tag" : title;
                pm.print(job, web.createPrintDocumentAdapter(job),
                        new PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.NA_LETTER).build());
            });
        }

        @JavascriptInterface
        public boolean copyText(String text) {
            ClipboardManager cm = getSystemService(ClipboardManager.class);
            if (cm == null) return false;
            cm.setPrimaryClip(ClipData.newPlainText("Build Tag", text));
            return true;
        }
    }
}
