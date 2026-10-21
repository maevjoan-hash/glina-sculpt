package bg.glina.sculpt;

import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.widget.Toast;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

/**
 * Глина on Android: the web app (assets/public/index.html) in a full-screen WebView.
 *
 * - The status and navigation bars are hidden while sculpting; a swipe from the screen edge
 *   shows them for a moment on top of the app, and they hide again by themselves.
 * - The screen stays on while the app is in front.
 * - Back does not close the app by accident: the first press shows a hint, a second press
 *   within 2 seconds sends the app to the background (the page keeps running, so the
 *   autosave still finishes).
 * - The WebView is kept clear of the system bars and camera cutouts by margins, so nothing in
 *   the page is ever covered and the page's own safe-area padding never doubles up.
 * - "Import" (<input type=file accept=".obj,.stl">) opens the system picker with every file
 *   selectable; see useOpenAnyFilePicker.
 * Stylus pressure, tilt and the eraser reach the page as ordinary PointerEvents; nothing here
 * intercepts touch or pen input.
 */
public class MainActivity extends BridgeActivity {

    private static final long EXIT_WINDOW_MS = 2000;

    private long lastBackPress = 0;
    private Toast exitHint;

    // the page's pending <input type=file>, answered when the system picker returns
    private ValueCallback<Uri[]> pendingFiles;
    private final ActivityResultLauncher<Intent> filePicker = registerForActivityResult(
        new ActivityResultContracts.StartActivityForResult(),
        result -> {
            ValueCallback<Uri[]> callback = pendingFiles;
            pendingFiles = null;
            if (callback == null) return;
            Intent data = result.getData();
            ClipData several = data != null ? data.getClipData() : null;
            if (result.getResultCode() == RESULT_OK && several != null) {
                Uri[] uris = new Uri[several.getItemCount()];
                for (int i = 0; i < uris.length; i++) uris[i] = several.getItemAt(i).getUri();
                callback.onReceiveValue(uris);
            } else {
                callback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.getResultCode(), data));
            }
        }
    );

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        hideSystemBars();
        keepWebViewOutOfCutouts();
        useOpenAnyFilePicker();
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                onBackPress();
            }
        });
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // coming back from the share sheet, a dialog or another app
        if (hasFocus) hideSystemBars();
    }

    private void hideSystemBars() {
        WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        bars.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        bars.hide(WindowInsetsCompat.Type.systemBars());
    }

    private void onBackPress() {
        long now = SystemClock.uptimeMillis();
        if (lastBackPress != 0 && now - lastBackPress < EXIT_WINDOW_MS) {
            lastBackPress = 0;
            if (exitHint != null) exitHint.cancel();
            moveTaskToBack(true);
            return;
        }
        lastBackPress = now;
        if (exitHint != null) exitHint.cancel();
        exitHint = Toast.makeText(this, R.string.press_back_again, Toast.LENGTH_SHORT);
        exitHint.show();
    }

    /**
     * Android's file pickers filter by MIME type only. For accept=".obj,.stl" Capacitor looks the
     * extensions up in the system's MIME table: depending on the Android version that gives odd
     * types (STL as a certificate list, OBJ as a drawing) or nothing at all, and a file whose
     * provider reports another type (model/stl, application/octet-stream, ...) is greyed out,
     * so the user could not pick their model. When the page asks only for file extensions, the
     * picker shows every file instead; the page checks the name and reports a wrong file itself.
     * Everything else (MIME types, camera capture) stays with Capacitor.
     */
    private void useOpenAnyFilePicker() {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        getBridge().getWebView().setWebChromeClient(new BridgeWebChromeClient(getBridge()) {
            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (params.isCaptureEnabled() || !onlyExtensions(params.getAcceptTypes())) {
                    return super.onShowFileChooser(webView, callback, params);
                }
                if (pendingFiles != null) pendingFiles.onReceiveValue(null);
                pendingFiles = callback;
                Intent pick = new Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
                if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                try {
                    filePicker.launch(pick);
                } catch (ActivityNotFoundException e) {
                    pendingFiles = null;
                    callback.onReceiveValue(null);
                }
                return true;
            }
        });
    }

    private static boolean onlyExtensions(String[] acceptTypes) {
        if (acceptTypes == null || acceptTypes.length == 0) return false;
        for (String type : acceptTypes) {
            if (type == null || !type.trim().startsWith(".")) return false;
        }
        return true;
    }

    /**
     * Capacitor's SystemBars plugin pads the window for the system bars and, on WebView 140+
     * with viewport-fit=cover, passes the bar and cutout insets on to the page instead, as
     * env(safe-area-inset-*). How much of that the page then honours depends on the WebView
     * version, so here the WebView simply gets margins for whatever insets reach it and the page
     * is told they are zero: the 3D view and the tool rail are never under a camera cutout,
     * and nothing is padded twice. With the bars hidden only the cutout is left.
     */
    private void keepWebViewOutOfCutouts() {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        View webView = getBridge().getWebView();
        final int types = WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout();
        ViewCompat.setOnApplyWindowInsetsListener(webView, (v, insets) -> {
            Insets safe = insets.getInsets(types);
            ViewGroup.LayoutParams lp = v.getLayoutParams();
            if (lp instanceof ViewGroup.MarginLayoutParams) {
                ViewGroup.MarginLayoutParams m = (ViewGroup.MarginLayoutParams) lp;
                if (m.leftMargin != safe.left || m.topMargin != safe.top || m.rightMargin != safe.right || m.bottomMargin != safe.bottom) {
                    m.setMargins(safe.left, safe.top, safe.right, safe.bottom);
                    v.setLayoutParams(m);
                }
            }
            WindowInsetsCompat rest = new WindowInsetsCompat.Builder(insets).setInsets(types, Insets.NONE).build();
            return ViewCompat.onApplyWindowInsets(v, rest);
        });
        ViewCompat.requestApplyInsets(webView);
    }
}
