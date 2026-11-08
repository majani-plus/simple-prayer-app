package app.simpleprayer.wear

import android.content.SharedPreferences
import android.os.Bundle
import android.view.HapticFeedbackConstants
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.rememberScrollState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.LayoutDirection
import androidx.wear.compose.foundation.pager.HorizontalPager
import androidx.wear.compose.foundation.pager.PagerState
import androidx.wear.compose.foundation.pager.rememberPagerState
import androidx.wear.compose.material.HorizontalPageIndicator
import androidx.wear.compose.material.PageIndicatorState
import androidx.wear.compose.material.PositionIndicator
import androidx.wear.compose.material.Scaffold
import androidx.wear.tiles.TileService
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.delay

/**
 * The Wear app: two pages — the Today hero (the Apple Watch app's twin; rotary scroll instead of
 * the crown is the whole difference) and the qibla dial, which exists only while the envelope
 * carries a bearing. Black canvas always (WO-V13); every other colour is still the night
 * manuscript's. Everything drawn here came pre-resolved from the phone; a tap appends to the D92
 * queue and repaints, nothing more.
 */
class MainActivity : ComponentActivity() {

  private var envelopeVersion by mutableIntStateOf(0)
  private val prefsListener = SharedPreferences.OnSharedPreferenceChangeListener { _, _ ->
    envelopeVersion++
  }

  private val notificationPermission =
    registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    EnvelopeStore.prefs(this).registerOnSharedPreferenceChangeListener(prefsListener)
    seedFromDataLayerIfEmpty()

    setContent {
      // Reading the version subscribes the whole tree to envelope arrivals.
      val envelope = remember(envelopeVersion) { EnvelopeStore.load(this) }
      var overlayVersion by remember { mutableIntStateOf(0) }
      var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
      LaunchedEffect(Unit) {
        while (true) {
          now = System.currentTimeMillis()
          delay(1000 - now % 1000)
        }
      }

      // The local adhan can only speak with the OS's leave; asked once, quietly, and only
      // when there is anything to say (the user turned adhans on, on the phone).
      LaunchedEffect(envelope?.alerts?.entries?.isNotEmpty() == true) {
        if (envelope?.alerts?.entries?.isNotEmpty() == true && !AlertScheduler.canNotify(this@MainActivity)) {
          notificationPermission.launch(android.Manifest.permission.POST_NOTIFICATIONS)
        }
      }

      val view = LocalView.current
      val face = remember(envelope, overlayVersion, now) {
        TodayModel.resolve(this, envelope, now)
      }
      val onTap: (String, String, TodayModel.Tap) -> Unit = { day, prayer, tap ->
        WearPendingMarks.appendTap(this, day, prayer, clears = tap == TodayModel.Tap.UNDO)
        view.performHapticFeedback(HapticFeedbackConstants.CONFIRM)
        TileService.getUpdater(this).requestUpdate(PrayerTileService::class.java)
        overlayVersion++
      }

      BlackCanvas {
        val qibla = envelope?.qibla
        val pages = if (qibla != null) 2 else 1
        val pagerState = rememberPagerState { pages }
        // Hoisted out of the Today page so the Scaffold's scroll indicator can read it (WO-V8).
        val todayScroll = rememberScrollState()
        val indicatorState = remember(pagerState) { PagerIndicatorState(pagerState) }

        // Deliberately NO Wear `MaterialTheme` around this. It would be the way to tint the
        // scroll rail from white to the manuscript's ink — but it also swaps `LocalIndication`
        // from Compose's default overlay to a Material ripple, which would silently change how
        // every seal answers a press. The tap IS the product; a transient 4dp rail in the system's
        // own white is a much smaller thing to give up than a redesigned touch feedback nobody
        // asked for. The page dots take the app's gold by argument instead.
        Scaffold(
          // WO-V8, "display scroll bar when user interacts with a scrollable view". It hides
          // itself when there is nothing to scroll, so the qibla page and the bundled state
          // never show a rail.
          positionIndicator = { PositionIndicator(scrollState = todayScroll) },
          // The dots that say a second page exists, in the app's own gold — shown only when the
          // qibla page is really there (owner, 2026-08-28: the page needs an indicator). Wear's
          // own component now, curved along the bezel where the hand-rolled Row was straight.
          pageIndicator = {
            if (pages > 1) {
              HorizontalPageIndicator(
                pageIndicatorState = indicatorState,
                selectedColor = pal("accent"),
                unselectedColor = pal("borderMid")
              )
            }
          }
          // Two Scaffold slots are deliberately empty, and both would cost more than they pay:
          //   • `vignette` — it darkens the top and bottom of the screen to soften scrolling
          //     content against the bezel. The canvas is already pure black (WO-V13), so there
          //     is nothing left for it to darken.
          //   • `timeText` — the crown is already the hero's own header (mosque mark + hijri
          //     date, which the owner asked to be readable without scrolling). A curved clock
          //     lands exactly there and would OVERLAP it, which WO-V16 forbids in the same
          //     breath as it forbids clipping. TimeText is a Material convention, not a
          //     numbered requirement, so the requirement wins over the convention.
        ) {
          HorizontalPager(
            state = pagerState,
            modifier = Modifier.fillMaxSize()
            // Wear's pager, not the phone's (WO-V3). Its default `gestureInclusion` leaves a
            // zone on the left edge of the first page to the system's swipe-to-dismiss, which
            // the phone pager swallowed — on page 0 there was nowhere left to scroll and the
            // app could not be swiped closed. Rotary stays off here by default, so the Today
            // page keeps the bezel for its own scrolling.
          ) { page ->
            if (page == 0) {
              val rtl = envelope?.snapshot?.rtl == true
              CompositionLocalProvider(
                LocalLayoutDirection provides if (rtl) LayoutDirection.Rtl else LayoutDirection.Ltr
              ) {
                TodayScreen(face = face, now = now, scroll = todayScroll, onTap = onTap)
              }
            } else if (qibla != null) {
              // The dial never mirrors — its geometry is geographic, not typographic.
              CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr) {
                QiblaScreen(qibla = qibla, language = envelope.snapshot.language)
              }
            }
          }
        }
      }
    }
  }

  override fun onDestroy() {
    EnvelopeStore.prefs(this).unregisterOnSharedPreferenceChangeListener(prefsListener)
    super.onDestroy()
  }

  override fun onResume() {
    super.onResume()
    envelopeVersion++
  }

  /**
   * The Data Layer persists the envelope item, but the listener service only hears CHANGES — an
   * app installed after the phone last synced would wait forever. First launch pulls whatever is
   * already sitting in the layer.
   */
  private fun seedFromDataLayerIfEmpty() {
    if (EnvelopeStore.hasEverSynced(this)) return
    Wearable.getDataClient(this).dataItems.addOnSuccessListener { buffer ->
      buffer.use { items ->
        for (item in items) {
          if (item.uri.path?.startsWith(WearWire.ENVELOPE_PATH) != true) continue
          val json = DataMapItem.fromDataItem(item.freeze()).dataMap.getString(WearWire.KEY_JSON) ?: continue
          EnvelopeStore.store(this, json)
          AlertScheduler.rearm(this)
          break
        }
      }
    }
  }
}

/**
 * The Wear pager's state in the shape [HorizontalPageIndicator] reads. Wear Material (M2) has no
 * overload that takes a `PagerState` directly; the indicator normalizes the offset itself, so the
 * pager's signed −0.5..0.5 fraction is handed straight through.
 */
private class PagerIndicatorState(private val pager: PagerState) : PageIndicatorState {
  override val pageOffset: Float get() = pager.currentPageOffsetFraction
  override val selectedPage: Int get() = pager.currentPage
  override val pageCount: Int get() = pager.pageCount
}

/**
 * The app canvas: pure black, which Wear OS quality guideline WO-V13 asks of every app screen and
 * tile ("does not use a black background for all apps and tiles" was Play's finding on version
 * 900000005). It replaced the night-paper vignette that used to be painted here.
 *
 * Only the canvas changed. Every other colour on this watch is still the night manuscript's,
 * reached through [pal] — the cards, the hairlines, the gold, the ink — so the page still reads as
 * the same paper, now lit against black instead of printed on brown.
 */
@Composable
private fun BlackCanvas(content: @Composable () -> Unit) {
  Box(modifier = Modifier.fillMaxSize().background(Color.Black)) {
    content()
  }
}
