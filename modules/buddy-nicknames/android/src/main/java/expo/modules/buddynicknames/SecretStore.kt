package expo.modules.buddynicknames

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * This phone's relay secret, kept where a process with no JS can still reach it.
 *
 * ## Why it moved here
 *
 * The secret used to live in `expo-secure-store`, which only the app's JS can read. That was right
 * while only the app ever talked to the relay. It stopped being right the moment a seal tap on a
 * widget had to tell a buddy by itself (D180): the tap is handled by a broadcast receiver with no
 * React runtime anywhere, and a secret it cannot read is a notification that waits for the next
 * time the app is opened.
 *
 * ## What protects it
 *
 * The Android Keystore, directly — no `androidx.security`, which would be a dependency for a
 * wrapper around exactly this. A 256-bit AES key lives in the keystore under [ALIAS] and never
 * leaves it; what lands in SharedPreferences is `base64(iv):base64(ciphertext)`, useless without
 * the key, and the key is not extractable even from a rooted backup of the file.
 *
 * What is stored is the same JSON the app has always stored — `{ deviceId, secret }` — so the
 * value migrating out of `expo-secure-store` needs no translation
 * (`src/services/buddyCredentials.ts`).
 *
 * ## Failure
 *
 * Every path returns `null` or does nothing. A key the system invalidated (a factory reset of the
 * secure hardware, a restored backup carrying the ciphertext but not the key) reads as "buddy mode
 * is not set up" — the app registers again, which costs the person nothing and their buddies
 * nothing. It never throws: this is called from a receiver, where an exception crashes the app
 * from the background with no screen to explain it.
 */
internal object SecretStore {
  private const val ALIAS = "app.simpleprayer.buddy"
  private const val TRANSFORMATION = "AES/GCM/NoPadding"
  private const val KEYSTORE = "AndroidKeyStore"
  private const val TAG_BITS = 128
  private const val SEPARATOR = ":"

  fun write(context: Context, json: String) {
    try {
      val cipher = Cipher.getInstance(TRANSFORMATION)
      cipher.init(Cipher.ENCRYPT_MODE, key())
      val ciphertext = cipher.doFinal(json.toByteArray(Charsets.UTF_8))
      BridgeStore.write(
        context,
        BridgeStore.KEY_SECRET,
        encode(cipher.iv) + SEPARATOR + encode(ciphertext)
      )
    } catch (_: Throwable) {
      // Without somewhere safe to keep it, buddy mode does not start — the same answer the JS side
      // gives when the keychain will not open. Never a fallback to plain storage.
    }
  }

  fun read(context: Context): String? {
    return try {
      val stored = BridgeStore.read(context, BridgeStore.KEY_SECRET) ?: return null
      val parts = stored.split(SEPARATOR)
      if (parts.size != 2) return null
      val iv = decode(parts[0])
      val ciphertext = decode(parts[1])
      val cipher = Cipher.getInstance(TRANSFORMATION)
      cipher.init(Cipher.DECRYPT_MODE, existingKey() ?: return null, GCMParameterSpec(TAG_BITS, iv))
      String(cipher.doFinal(ciphertext), Charsets.UTF_8)
    } catch (_: Throwable) {
      null
    }
  }

  fun clear(context: Context) {
    BridgeStore.clear(context, BridgeStore.KEY_SECRET)
    try {
      KeyStore.getInstance(KEYSTORE).apply { load(null) }.deleteEntry(ALIAS)
    } catch (_: Throwable) {
      // The ciphertext is gone either way, which is what "forget the secret" means here.
    }
  }

  /** The stored key, or a new one. Generating is idempotent from the caller's point of view. */
  private fun key(): SecretKey = existingKey() ?: generateKey()

  private fun existingKey(): SecretKey? {
    return try {
      val keystore = KeyStore.getInstance(KEYSTORE).apply { load(null) }
      (keystore.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.secretKey
    } catch (_: Throwable) {
      null
    }
  }

  private fun generateKey(): SecretKey {
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
    generator.init(
      KeyGenParameterSpec.Builder(
        ALIAS,
        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
      )
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        // Deliberately NOT user-authentication-bound: a widget tap can land on a locked phone,
        // and a buddy flag that waits for an unlock is a buddy flag that arrives tomorrow.
        .setUserAuthenticationRequired(false)
        .build()
    )
    return generator.generateKey()
  }

  private fun encode(bytes: ByteArray) = Base64.encodeToString(bytes, Base64.NO_WRAP)

  private fun decode(value: String): ByteArray = Base64.decode(value, Base64.NO_WRAP)
}
