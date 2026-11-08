import CoreLocation
import SwiftUI
import WatchKit

/**
 The qibla page (V0a, canvas `WatchQibla.dc.html`): the in-app dial on a round canvas. The
 bearing was computed on the phone and rides the envelope; this file compares the OS heading to
 that one number — rendering math, not domain logic (the same license a segment lookup has).

 Rules carried from the phone (D86): engage at ≤5°, release past 6°, one haptic on engage, green
 for alignment and nothing else, state never color-alone (icon + word). The dial never mirrors
 in RTL — its geometry is geographic. The live degree readout is formatted in the app language's
 numerals natively — a number, not a sentence (the widgets' countdown class of exception).
 */
struct QiblaView: View {
  let qibla: WatchEnvelope.Qibla
  let language: String

  @StateObject private var heading = HeadingModel()

  private var cardinals: [String] {
    [qibla.north ?? "", qibla.east ?? "", qibla.south ?? "", qibla.west ?? ""]
  }

  var body: some View {
    let c = { (role: String) in WidgetPalette.color(role, night: watchNight) }
    VStack(spacing: 8) {
      if let deviceHeading = heading.degrees {
        let delta = shortestDelta(from: deviceHeading, to: qibla.bearing)
        Dial(
          rotation: -deviceHeading,
          bearing: qibla.bearing,
          aligned: heading.aligned,
          cardinals: cardinals
        )
        .frame(width: 128, height: 128)
        if heading.aligned {
          HStack(spacing: 4) {
            GlyphCheck()
              .stroke(c("alignedText"), style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
              .frame(width: 12, height: 12)
            Text(qibla.alignedLabel)
              .font(WidgetFonts.ui(language, 13, weight: .semibold))
              .foregroundStyle(c("alignedText"))
          }
        } else {
          Text("\(formattedDegrees(abs(delta))) \(delta > 0 ? qibla.toRightLabel : qibla.toLeftLabel)")
            .font(WidgetFonts.ui(language, 12, italic: true))
            .foregroundStyle(c("muted"))
        }
      } else {
        // No heading yet (or no compass): the bearing is still true and still useful.
        Dial(rotation: 0, bearing: qibla.bearing, aligned: false, cardinals: cardinals)
          .frame(width: 128, height: 128)
        Text(formattedDegrees(qibla.bearing))
          .font(WidgetFonts.ui(language, 13, weight: .semibold))
          .foregroundStyle(c("inkStrong"))
      }
    }
    .onAppear { heading.start(bearing: qibla.bearing) }
    .onDisappear { heading.stop() }
  }

  private func formattedDegrees(_ value: Double) -> String {
    let formatter = NumberFormatter()
    formatter.locale = Locale(identifier: language)
    formatter.maximumFractionDigits = 0
    let number = formatter.string(from: NSNumber(value: value)) ?? String(Int(value))
    return "\(number)°"
  }
}

/// Signed shortest rotation from → to, in (-180, 180], clockwise-positive — the same convention
/// as `src/domain/qibla.ts`'s `shortestAngleDelta` (positive means "turn right").
private func shortestDelta(from: Double, to: Double) -> Double {
  var delta = (to - from).truncatingRemainder(dividingBy: 360)
  if delta <= -180 { delta += 360 }
  if delta > 180 { delta -= 360 }
  return delta
}

// MARK: - The dial

private struct Dial: View {
  /// Degrees to rotate the world ring by (negative device heading).
  let rotation: Double
  let bearing: Double
  let aligned: Bool
  /// N/E/S/W in the app's language, clockwise from north; empty strings hide the engraving
  /// (an envelope from before the field existed).
  let cardinals: [String]

  var body: some View {
    let c = { (role: String) in WidgetPalette.color(role, night: watchNight) }
    ZStack {
      Circle()
        .fill(aligned ? c("alignedTintBg") : Color.clear)
      Circle()
        .strokeBorder(aligned ? c("alignedTintBorder") : c("borderMid"), lineWidth: 1.5)
      // Ticks + the Makkah badge live on the WORLD ring, rotated against the heading.
      ZStack {
        ForEach(0..<8, id: \.self) { index in
          Capsule()
            .fill(c("hairline"))
            .frame(width: 1.5, height: 6)
            .offset(y: -57)
            .rotationEffect(.degrees(Double(index) * 45))
        }
        // The cardinal engravings (owner, 2026-08-28): they ride the world ring to their
        // quarter, then counter-rotate by the ring's own turn so the letters stay upright.
        ForEach(Array(cardinals.enumerated()), id: \.offset) { index, letter in
          if !letter.isEmpty {
            Text(letter)
              .font(.system(size: 10, weight: .medium))
              .foregroundStyle(c("soft"))
              .rotationEffect(.degrees(-Double(index) * 90 - rotation))
              .offset(y: -44)
              .rotationEffect(.degrees(Double(index) * 90))
          }
        }
        MakkahBadge(aligned: aligned)
          .offset(y: -50)
          .rotationEffect(.degrees(bearing))
      }
      .rotationEffect(.degrees(rotation))
      // The needle is the DEVICE: fixed pointing up.
      Needle(color: aligned ? c("aligned") : c("inkStrong"))
    }
    .animation(.easeInOut(duration: 0.25), value: rotation)
  }
}

private struct MakkahBadge: View {
  let aligned: Bool

  var body: some View {
    let c = { (role: String) in WidgetPalette.color(role, night: watchNight) }
    ZStack {
      Circle()
        .fill(aligned ? c("aligned") : composite(c("bg"), c("cardBright")))
      Circle()
        .strokeBorder(aligned ? Color.clear : c("borderStrong"), lineWidth: 1)
      MosqueMark(color: aligned ? c("alignedFg") : c("inkStrong"), size: 12)
    }
    .frame(width: 19, height: 19)
  }
}

private struct Needle: View {
  let color: Color

  var body: some View {
    ZStack {
      NeedleShape()
        .fill(color)
        .frame(width: 10, height: 52)
        .offset(y: -12)
      Circle().fill(color).frame(width: 7, height: 7)
      Circle().fill(WidgetPalette.color("bg", night: watchNight)).frame(width: 3, height: 3)
    }
  }
}

private struct NeedleShape: Shape {
  func path(in rect: CGRect) -> Path {
    var path = Path()
    path.move(to: CGPoint(x: rect.midX, y: rect.minY))
    path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY * 0.88))
    path.addLine(to: CGPoint(x: rect.midX, y: rect.maxY))
    path.addLine(to: CGPoint(x: rect.minX, y: rect.maxY * 0.88))
    path.closeSubpath()
    return path
  }
}

// MARK: - Heading

/**
 The heading stream, smoothed on the short arc and gated by D86's hysteresis. `nil` degrees is a
 normal state (no fix yet, or hardware without a compass) — the page stays useful with the bare
 bearing rather than pretending.
 */
private final class HeadingModel: NSObject, ObservableObject, CLLocationManagerDelegate {
  @Published var degrees: Double?
  @Published var aligned = false

  private let manager = CLLocationManager()
  private var bearing: Double = 0

  func start(bearing: Double) {
    self.bearing = bearing
    guard CLLocationManager.headingAvailable() else { return }
    manager.delegate = self
    // watchOS gates heading behind when-in-use authorization (unlike iOS, it will not start
    // silently) — ask, and start only once the answer arrives (the delegate callback below).
    // A denial simply leaves `degrees` nil: the page stays useful with the bare bearing.
    switch manager.authorizationStatus {
    case .notDetermined:
      manager.requestWhenInUseAuthorization()
    case .authorizedWhenInUse, .authorizedAlways:
      manager.startUpdatingHeading()
    default:
      break
    }
  }

  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    switch manager.authorizationStatus {
    case .authorizedWhenInUse, .authorizedAlways:
      manager.startUpdatingHeading()
    default:
      break
    }
  }

  func stop() {
    manager.stopUpdatingHeading()
  }

  func locationManager(_ manager: CLLocationManager, didUpdateHeading newHeading: CLHeading) {
    // True heading when the OS can supply it; magnetic otherwise — the phone app's own order.
    let raw = newHeading.trueHeading >= 0 ? newHeading.trueHeading : newHeading.magneticHeading
    guard raw >= 0 else { return }
    let previous = degrees
    let smoothed: Double
    if let previous {
      var delta = (raw - previous).truncatingRemainder(dividingBy: 360)
      if delta <= -180 { delta += 360 }
      if delta > 180 { delta -= 360 }
      smoothed = (previous + 0.25 * delta).truncatingRemainder(dividingBy: 360)
    } else {
      smoothed = raw
    }
    degrees = smoothed < 0 ? smoothed + 360 : smoothed

    var offset = (bearing - (degrees ?? raw)).truncatingRemainder(dividingBy: 360)
    if offset <= -180 { offset += 360 }
    if offset > 180 { offset -= 360 }
    let magnitude = abs(offset)
    // Engage at ≤5°, release past 6° (D86) — and the wrist taps once on engage, never on hold.
    if !aligned, magnitude <= 5 {
      aligned = true
      WKInterfaceDevice.current().play(.click)
    } else if aligned, magnitude > 6 {
      aligned = false
    }
  }
}
