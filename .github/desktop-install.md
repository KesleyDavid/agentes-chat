<!-- install -->
## Installing (first open)

The desktop app is in beta: the Mac build isn't notarized by Apple yet and the Windows installer isn't signed by Microsoft, so the first open asks once. After that it opens and updates by itself.

**macOS**: drag agentes.chat to Applications and open it, click **Done**, then open **System Settings › Privacy & Security** and click **Open Anyway** (it shows up only right after you try to open the app, for about an hour). Confirm with Touch ID or your password.

![Open the app, click Done, then Open Anyway in Privacy & Security](https://github.com/{{repo}}/raw/main/docs/images/first-open-mac.png)

If the button never shows up, or macOS says the app is damaged, run `xattr -dr com.apple.quarantine /Applications/agentes.chat.app` in Terminal and open it again.

**Windows** (`x64-setup.exe`, or `arm64-setup.exe` on an ARM computer): if your browser asks, choose **Keep**. When **Windows protected your PC** shows up, click **More info**, then **Run anyway**.

**Linux**: `sudo apt install ./agentes_{{version}}_amd64.deb` (`_arm64.deb` on an ARM computer).

Every step, with pictures: https://app.agentes.chat/download (also at `/download` on your own server).
