package com.yansuu1.jizhang

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import com.yansuu1.jizhang.net.ApiClient
import com.yansuu1.jizhang.repo.AuthRepository
import com.yansuu1.jizhang.ui.LoginScreen
import com.yansuu1.jizhang.ui.MainShell
import com.yansuu1.jizhang.ui.readThemePrefs
import com.yansuu1.jizhang.ui.theme.AccentPreset
import com.yansuu1.jizhang.ui.theme.JizhangTheme
import com.yansuu1.jizhang.ui.theme.ThemePreference
import com.yansuu1.jizhang.ui.writeThemePrefs
import kotlinx.coroutines.launch

/**
 * Entry: session gate (login <-> shell) + persisted theme (A10/A11).
 * Mirrors web `router/index.ts` guard: the session resolves once before
 * deciding where to land; 401 stays on login.
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val api = ApiClient(applicationContext)
        val auth = AuthRepository(api)
        setContent {
            val scope = rememberCoroutineScope()
            var theme by remember { mutableStateOf(ThemePreference.System) }
            var accent by remember { mutableStateOf(AccentPreset.Titanium) }
            LaunchedEffect(Unit) {
                val (t, a) = readThemePrefs(applicationContext)
                theme = t
                accent = a
            }
            JizhangTheme(preference = theme, accent = accent) {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background,
                ) {
                    var signedIn by remember { mutableStateOf(false) }
                    if (signedIn) {
                        MainShell(
                            api = api,
                            auth = auth,
                            theme = theme,
                            accent = accent,
                            onTheme = { t ->
                                theme = t
                                scope.launch { writeThemePrefs(applicationContext, t, accent) }
                            },
                            onAccent = { a ->
                                accent = a
                                scope.launch { writeThemePrefs(applicationContext, theme, a) }
                            },
                            onLogout = { signedIn = false },
                            onAuthExpired = { signedIn = false },
                        )
                    } else {
                        LoginScreen(
                            api = api,
                            auth = auth,
                            onLoggedIn = { signedIn = true },
                        )
                    }
                }
            }
            @Suppress("UNUSED_EXPRESSION")
            isSystemInDarkTheme().let { }
        }
    }
}
