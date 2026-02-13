# android-visual-automation
Visual Regression Pack for Android APKs

# Next: Let’s Prove It Works

First Open termanl and run 
appium --use-plugins=images

Open a **new terminal window** (leave Appium running).

---

## Step 1 — Confirm Emulator Is Visible

```bash
adb devices
```

You should see:

```
emulator-5554 device
```

If not, start your emulator from:

**Android Studio**

---

## Step 2 — Place One Test APK

In your repo:

```
Android-visual-automation/
   apps/app1.apk
   icons/app1_home.png
```

Make sure:

* APK file exists
* PNG icon is tightly cropped

---

## Step 3 — Run Your First Visual Test

From your repo root:

```bash
npm test
```

What should happen:

1. Appium connects
2. Installs APK
3. Launches app
4. Searches screen for PNG
5. Clicks it if found

---

# ⚠ If Image Is Not Found

We’ll adjust confidence threshold.

The images plugin supports:

```javascript
const element = await driver.findElement('image', imageBase64);
```

But we can improve matching by adding settings:

```javascript
await driver.updateSettings({
  imageMatchThreshold: 0.4
});
```

Default is strict (0.4–0.5 is good starting point).

---

# Important for 36 Apps

Since you’ll scale this:

* Lock emulator resolution
* Disable animations
* Use same DPI
* Use consistent PNG size

Disable animations (run once):

```bash
adb shell settings put global window_animation_scale 0
adb shell settings put global transition_animation_scale 0
adb shell settings put global animator_duration_scale 0
```

---

# You Are Now Ready For

Option A — Test 1 app manually
Option B — Auto-loop through all 36
Option C — Build a smart PNG detection engine
Option D — Add reporting
Option E — Prepare CI-ready version

---

Before we scale it, let’s confirm:

Run your test script.

Tell me:

* Does the app launch?
* Does the PNG click?
* Or does it say image not found?

We’ll tune it from there 👇

