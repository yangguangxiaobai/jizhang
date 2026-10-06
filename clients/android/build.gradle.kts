// Top-level build file — jizhang Android client.
// NOTE: Kotlin 1.9.24 has no dedicated Compose plugin artifact; the Compose
// compiler ships via the Kotlin Android plugin + compose=true (AGP/Kotlin pair
// below). Do NOT add `org.jetbrains.kotlin.plugin.compose` on this Kotlin line.
plugins {
    id("com.android.application") version "8.5.2" apply false
    id("org.jetbrains.kotlin.android") version "1.9.24" apply false
}
