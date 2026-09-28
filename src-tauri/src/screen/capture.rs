//! Virtual-screen capture via GDI.
//!
//! Deliberately minimal: a `BitBlt` of the virtual desktop into an in-memory
//! bitmap, downscaled and PNG-encoded in RAM. The image is **never written to
//! disk** — the buffer is handed straight to the Claude request and dropped
//! when that request finishes, so there is no temporary file to leak or clean
//! up. This runs only from an explicit user action.

/// Longest edge of the image sent to the model. Full-resolution screenshots can
/// cost ~3x the image tokens for detail that rarely changes the answer; 1920
/// keeps on-screen code comfortably legible at a fraction of the cost.
const MAX_EDGE: u32 = 1920;

/// One captured frame of the virtual desktop, top-down BGRA.
pub struct Frame {
    pub bgra: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

impl Frame {
    /// PNG for a vision model: downscaled, alpha dropped.
    pub fn to_png(&self) -> Result<Vec<u8>, String> {
        encode(&self.bgra, self.width, self.height)
    }
}

#[cfg(windows)]
pub fn capture_png() -> Result<Vec<u8>, String> {
    capture_frame()?.to_png()
}

#[cfg(windows)]
pub fn capture_frame() -> Result<Frame, String> {
    use std::mem::size_of;

    use windows::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC,
        GetDIBits, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, CAPTUREBLT,
        DIB_RGB_COLORS, SRCCOPY,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetSystemMetrics, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN,
        SM_YVIRTUALSCREEN,
    };

    unsafe {
        let origin_x = GetSystemMetrics(SM_XVIRTUALSCREEN);
        let origin_y = GetSystemMetrics(SM_YVIRTUALSCREEN);
        let width = GetSystemMetrics(SM_CXVIRTUALSCREEN);
        let height = GetSystemMetrics(SM_CYVIRTUALSCREEN);

        if width <= 0 || height <= 0 {
            return Err("Could not determine the screen size.".into());
        }

        let screen_dc = GetDC(None);
        if screen_dc.is_invalid() {
            return Err("Could not open a device context for the screen.".into());
        }

        // Everything below must release `screen_dc`, so failures funnel through
        // a closure rather than returning early.
        let result = (|| -> Result<Frame, String> {
            let mem_dc = CreateCompatibleDC(Some(screen_dc));
            if mem_dc.is_invalid() {
                return Err("Could not create a memory device context.".into());
            }
            let bitmap = CreateCompatibleBitmap(screen_dc, width, height);
            if bitmap.is_invalid() {
                let _ = DeleteDC(mem_dc);
                return Err("Could not allocate a capture bitmap.".into());
            }
            let previous = SelectObject(mem_dc, bitmap.into());

            let blit = BitBlt(
                mem_dc,
                0,
                0,
                width,
                height,
                Some(screen_dc),
                origin_x,
                origin_y,
                SRCCOPY | CAPTUREBLT,
            );

            let pixels = blit.and_then(|()| {
                let mut info = BITMAPINFO {
                    bmiHeader: BITMAPINFOHEADER {
                        biSize: size_of::<BITMAPINFOHEADER>() as u32,
                        biWidth: width,
                        // Negative height requests a top-down bitmap, matching
                        // the row order the image crate expects.
                        biHeight: -height,
                        biPlanes: 1,
                        biBitCount: 32,
                        biCompression: BI_RGB.0,
                        ..Default::default()
                    },
                    ..Default::default()
                };

                let mut buffer = vec![0u8; (width as usize) * (height as usize) * 4];
                let copied = GetDIBits(
                    mem_dc,
                    bitmap,
                    0,
                    height as u32,
                    Some(buffer.as_mut_ptr().cast()),
                    &mut info,
                    DIB_RGB_COLORS,
                );
                if copied == 0 {
                    Err(windows::core::Error::from_win32())
                } else {
                    Ok(buffer)
                }
            });

            SelectObject(mem_dc, previous);
            let _ = DeleteObject(bitmap.into());
            let _ = DeleteDC(mem_dc);

            let bgra = pixels.map_err(|e| format!("Screen capture failed: {e}"))?;
            Ok(Frame {
                bgra,
                width: width as u32,
                height: height as u32,
            })
        })();

        ReleaseDC(None, screen_dc);
        result
    }
}

#[cfg(not(windows))]
pub fn capture_png() -> Result<Vec<u8>, String> {
    Err("Screen capture is only implemented on Windows.".into())
}

#[cfg(not(windows))]
pub fn capture_frame() -> Result<Frame, String> {
    Err("Screen capture is only implemented on Windows.".into())
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    /// Exercises the real GDI path. The bytes stay in memory and are only
    /// checked for shape — nothing is written to disk or sent anywhere.
    #[test]
    fn captures_a_valid_png_of_the_screen() {
        let png = capture_png().expect("screen capture should succeed");
        assert!(png.len() > 1024, "suspiciously small capture");
        assert_eq!(
            &png[..8],
            &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A],
            "output should be a PNG"
        );
    }

    #[test]
    fn oversized_captures_are_downscaled() {
        let width = 3000u32;
        let height = 1500u32;
        let bgra = vec![0u8; (width as usize) * (height as usize) * 4];
        let png = encode(&bgra, width, height).expect("encode should succeed");

        let decoded = image::load_from_memory(&png).expect("should decode");
        assert_eq!(decoded.width(), MAX_EDGE);
        assert_eq!(decoded.height(), MAX_EDGE / 2);
    }
}

/// BGRA scanlines -> downscaled RGB -> PNG bytes.
fn encode(bgra: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
    use std::io::Cursor;

    use image::imageops::FilterType;
    use image::{ImageFormat, RgbImage};

    let mut rgb = Vec::with_capacity((width as usize) * (height as usize) * 3);
    for chunk in bgra.chunks_exact(4) {
        // GDI gives BGRA with an undefined alpha byte; drop it.
        rgb.push(chunk[2]);
        rgb.push(chunk[1]);
        rgb.push(chunk[0]);
    }

    let image = RgbImage::from_raw(width, height, rgb)
        .ok_or_else(|| "Captured pixel buffer had an unexpected size.".to_string())?;

    let longest = width.max(height);
    let image = if longest > MAX_EDGE {
        let ratio = MAX_EDGE as f64 / longest as f64;
        let target_w = ((width as f64 * ratio).round() as u32).max(1);
        let target_h = ((height as f64 * ratio).round() as u32).max(1);
        image::imageops::resize(&image, target_w, target_h, FilterType::Triangle)
    } else {
        image
    };

    let mut out = Vec::new();
    image
        .write_to(&mut Cursor::new(&mut out), ImageFormat::Png)
        .map_err(|e| format!("Could not encode the screenshot: {e}"))?;
    Ok(out)
}
