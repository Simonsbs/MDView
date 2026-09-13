# Installation

Download packages from the [MDView GitHub releases](https://github.com/Simonsbs/MDView/releases). Filenames include their version and CPU architecture. The examples below use version 1.0.0.

## Requirements

- Windows 10 or newer, x64; or an x64 Linux graphical desktop.
- Packaged applications include Electron and need no Node.js installation.
- Linux needs GTK 3, NSS, ALSA, GBM, the usual X11/desktop libraries, `xdg-utils` and `shared-mime-info`. Generic desktop sessions also need the `mimetype` utility (`libfile-mimeinfo-perl` on Debian/Ubuntu) so file-type detection uses the desktop MIME database. The Debian package declares its dependencies. AppImage and archives depend on the host providing these libraries.
- Source builds use Node.js 24 LTS and npm.

## Windows

### Installer

1. Run `MDView-1.0.0-windows-x64-setup.exe`.
2. Complete the current-user installation. It adds a Start menu entry, an uninstaller and `.md` application registration.
3. Leave **Open MDView and set the .md default** selected on the final page.
4. In Windows Default apps, choose **MDView** for **`.md`**.

The installer does not require administrator rights. Packages are unsigned, so Windows may show an unknown-publisher or SmartScreen prompt. Verify the release source and checksum before deciding whether to run a download.

### Portable

Run `MDView-1.0.0-windows-x64-portable.exe`. Keep it in a permanent location to use it as the default application:

```powershell
.\MDView-1.0.0-windows-x64-portable.exe --make-default
```

Registration points to the portable launcher, not its temporary extracted executable. Repeat registration if you move or rename it.

## Ubuntu and Debian

```sh
sudo apt install ./MDView-1.0.0-linux-x64.deb
mdview
```

The package provides an application-menu entry, a `mdview` command and the Markdown MIME association. On its first launch in each account, MDView selects itself as that user's Markdown default. Registration happens in the desktop user's account, not root's account during `apt install`.

## Other Linux desktops

### AppImage

```sh
chmod +x MDView-1.0.0-linux-x64.AppImage
./MDView-1.0.0-linux-x64.AppImage
```

Keep the AppImage at a stable path. Registration uses its real location rather than its temporary mount path. Without FUSE, use the archive, or extract the AppImage with `--appimage-extract` and run the extracted `mdview` executable.

### Archive

```sh
tar -xzf MDView-1.0.0-linux-x64.tar.gz
cd MDView-1.0.0-linux-x64
./mdview
```

Keep the whole directory together. The archive includes executable permissions, including when produced on Windows.

## Default application

### Windows

Setup registers the `.md` ProgID, quoted file-open command, icon, Open With entry and Default apps capabilities. It also sets the normal registry fallback for `.md`. An existing Windows `UserChoice` is protected and takes priority over that fallback.

Windows 11 opens MDView's Default apps page directly where supported. On Windows 10, select **Choose default apps by file type**, find **`.md`**, then choose **MDView**. Alternatively, right-click a `.md` file, choose **Open with > Choose another app**, select MDView and enable **Always use this app**.

Reopen the selection flow from an installed application:

```powershell
& "$env:LOCALAPPDATA\Programs\MDView\MDView.exe" --make-default
```

Use your chosen install path if it differs. Silent installation registers the app but does not complete a protected Windows default choice. MDView follows the [Windows default-app platform](https://learn.microsoft.com/en-us/windows/apps/develop/windows-integration/default-apps-platform) and [Default apps settings guidance](https://learn.microsoft.com/en-us/windows/apps/develop/launch/launch-default-apps-settings).

### Linux

Packaged MDView registers `text/markdown` for `*.md` and selects `mdview.desktop` for the current user. The first-launch action is recorded so it does not repeatedly reclaim a preference you later change. It never sets a default for `text/plain`.

```sh
mdview --make-default
xdg-mime query default text/markdown
xdg-mime query filetype example.md
```

The expected default is `mdview.desktop`; `.md` files should be identified as `text/markdown`. For portable packages, run their executable with `--make-default`. If desktop policy prevents the change, select MDView through the file manager's Open With settings.

## Open a particular file

```powershell
& "$env:LOCALAPPDATA\Programs\MDView\MDView.exe" "C:\Documents\notes.md"
```

```sh
mdview ~/Documents/notes.md
```

## Verify downloads

Download `SHA256SUMS.txt` alongside the package. On Linux:

```sh
sha256sum --check --ignore-missing SHA256SUMS.txt
```

On Windows, compare the following output with the matching checksum entry:

```powershell
Get-FileHash .\MDView-1.0.0-windows-x64-setup.exe -Algorithm SHA256
```

Checksums detect damaged or mismatched downloads; they do not replace publisher signatures.

## Update and uninstall

Install a newer Windows setup package over the existing installation, or install a newer `.deb` with `apt`. Replace portable builds at the same path and keep supporting files together. If the path changes, repeat `--make-default`. MDView has no automatic updater.

- Windows: use **Settings > Apps > MDView > Uninstall**. Installer-owned registration is removed and the previous fallback is restored when applicable. Windows controls protected user choices.
- Debian: `sudo apt remove mdview`. Its system desktop entry is removed. A desktop ignores unavailable applications when choosing a fallback.
- Portable: select another Markdown default, then delete the launcher or extracted directory. On Linux, also remove `~/.local/share/applications/mdview.desktop` if you registered a portable build and no longer use it.

Default-registration state and Electron's application data stay in the normal MDView user-data directory. Your documents are never deleted or changed by uninstalling.
