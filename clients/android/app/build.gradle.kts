import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// NOTE: Kotlin 1.9.24 predates the standalone Compose compiler plugin;
// compose=true on this AGP/Kotlin pair wires the bundled compiler.

// A13: version source of truth — root package.json `version` → versionName;
// versionCode increments per release (parity task P2 records each bump).
fun repoVersionName(): String {
    val raw = rootProject.file("../../package.json").readText()
    return Regex("\"version\"\\s*:\\s*\"([^\"]+)\"").find(raw)?.groupValues?.get(1) ?: "0.1.0"
}

// A13: release signing is user-local, never committed. Provide via
// `clients/android/keystore.properties` (gitignored) or env vars:
//   JIZHANG_STORE_FILE / JIZHANG_STORE_PASSWORD / JIZHANG_KEY_ALIAS / JIZHANG_KEY_PASSWORD
fun releaseSigning(): Map<String, String>? {
    val props = Properties()
    val f = rootProject.file("keystore.properties")
    if (f.exists()) {
        f.inputStream().use { props.load(it) }
    }
    fun pick(propKey: String, envKey: String): String? =
        props.getProperty(propKey)?.ifEmpty { null }
            ?: System.getenv(envKey)?.ifEmpty { null }
    val storeFile = pick("storeFile", "JIZHANG_STORE_FILE") ?: return null
    val storePassword = pick("storePassword", "JIZHANG_STORE_PASSWORD") ?: return null
    val keyAlias = pick("keyAlias", "JIZHANG_KEY_ALIAS") ?: return null
    val keyPassword = pick("keyPassword", "JIZHANG_KEY_PASSWORD") ?: return null
    return mapOf(
        "storeFile" to storeFile,
        "storePassword" to storePassword,
        "keyAlias" to keyAlias,
        "keyPassword" to keyPassword,
    )
}

android {
    namespace = "com.yansuu1.jizhang"
    compileSdk = 34

    defaultConfig {
        // NOTE: applicationId is provisional (parent PRD R7: confirm once before release).
        applicationId = "com.yansuu1.jizhang"
        minSdk = 26
        targetSdk = 34
        // versionName tracks the repo package.json; versionCode increments per release.
        versionCode = 3
        versionName = repoVersionName()
    }

    signingConfigs {
        create("release") {
            val cfg = releaseSigning()
            if (cfg != null) {
                storeFile = rootProject.file(cfg.getValue("storeFile"))
                storePassword = cfg.getValue("storePassword")
                keyAlias = cfg.getValue("keyAlias")
                keyPassword = cfg.getValue("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            // Signed only when the user provides keystore.properties/env (see above).
            // Without key material this falls back to the debug signature so
            // `assembleRelease` stays runnable for shape verification; store builds
            // for distribution MUST be signed (release signingConfig present).
            signingConfig = if (releaseSigning() != null) {
                signingConfigs.getByName("release")
            } else {
                signingConfigs.getByName("debug")
            }
        }
    }

    buildFeatures {
        compose = true
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    composeOptions {
        // AGP 8.5 bundles Compose Compiler 1.5.x, which pairs with Kotlin 1.9.x.
        kotlinCompilerExtensionVersion = "1.5.14"
    }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    testImplementation("org.json:json:20240303")
    val composeBom = platform("androidx.compose:compose-bom:2024.06.00")
    implementation(composeBom)
    androidTestImplementation(composeBom)

    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-compose:1.9.2")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-core")
    implementation("androidx.compose.material:material-icons-extended")

    // A1 network layer (N1–N7): OkHttp + DataStore.
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("androidx.datastore:datastore-preferences:1.1.1")

    // Reserved for later batches (repositories/navigation/serialization):
    // implementation("androidx.navigation:navigation-compose:2.7.7")
    // implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    // implementation("androidx.room:room-runtime:2.6.1")

    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
