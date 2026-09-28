//! On-device text recognition with the OCR engine built into Windows
//! (`Windows.Media.Ocr`).
//!
//! This is how a text-only local model "sees" the screen: the capture is read
//! into plain text on this machine and handed to the model as context. It
//! misses layout, colours and images, but it gets error messages, code and
//! document text — which is what "look at my screen" is usually about — and it
//! needs no extra model and no network.

use super::capture::Frame;

/// Keep the prompt within a small model's context window.
const MAX_CHARS: usize = 6000;

#[cfg(windows)]
pub fn recognize(frame: &Frame) -> Result<String, String> {
    use image::imageops::FilterType;
    use image::RgbaImage;
    use windows::Graphics::Imaging::{BitmapAlphaMode, BitmapPixelFormat, SoftwareBitmap};
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::Streams::DataWriter;

    let fail = |what: &str, e: windows::core::Error| format!("OCR {what} failed: {e}");

    let engine = OcrEngine::TryCreateFromUserProfileLanguages()
        .map_err(|e| fail("engine setup", e))?;

    // The engine rejects images above a fixed size, so large desktops are
    // scaled to fit. Channel order is irrelevant to resampling, so the BGRA
    // buffer can be resized as if it were RGBA.
    let max_dim = OcrEngine::MaxImageDimension().unwrap_or(2600);
    let (mut width, mut height) = (frame.width, frame.height);
    let pixels: Vec<u8> = if width.max(height) > max_dim {
        let ratio = max_dim as f64 / width.max(height) as f64;
        let w = ((width as f64 * ratio).floor() as u32).max(1);
        let h = ((height as f64 * ratio).floor() as u32).max(1);
        let img = RgbaImage::from_raw(width, height, frame.bgra.clone())
            .ok_or_else(|| "Captured pixel buffer had an unexpected size.".to_string())?;
        width = w;
        height = h;
        image::imageops::resize(&img, w, h, FilterType::Triangle).into_raw()
    } else {
        frame.bgra.clone()
    };

    let writer = DataWriter::new().map_err(|e| fail("buffer", e))?;
    writer.WriteBytes(&pixels).map_err(|e| fail("buffer", e))?;
    let buffer = writer.DetachBuffer().map_err(|e| fail("buffer", e))?;

    let bitmap = SoftwareBitmap::CreateCopyWithAlphaFromBuffer(
        &buffer,
        BitmapPixelFormat::Bgra8,
        width as i32,
        height as i32,
        BitmapAlphaMode::Ignore,
    )
    .map_err(|e| fail("bitmap", e))?;

    let result = engine
        .RecognizeAsync(&bitmap)
        .map_err(|e| fail("recognition", e))?
        .get()
        .map_err(|e| fail("recognition", e))?;

    let mut text = String::new();
    for line in result.Lines().map_err(|e| fail("result", e))? {
        let line = line.Text().map_err(|e| fail("result", e))?.to_string();
        let line = line.trim();
        if !line.is_empty() {
            text.push_str(line);
            text.push('\n');
        }
    }
    Ok(truncate(&text))
}

#[cfg(not(windows))]
pub fn recognize(_frame: &Frame) -> Result<String, String> {
    Err("On-device OCR is only available on Windows.".into())
}

fn truncate(text: &str) -> String {
    if text.len() <= MAX_CHARS {
        return text.to_string();
    }
    let mut cut = MAX_CHARS;
    while !text.is_char_boundary(cut) {
        cut -= 1;
    }
    format!("{}\n[…screen text truncated…]", &text[..cut])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn long_text_is_truncated_on_a_char_boundary() {
        let text = "é".repeat(MAX_CHARS);
        let out = truncate(&text);
        assert!(out.ends_with("[…screen text truncated…]"));
        assert!(out.len() < text.len());
    }

    /// Real OCR against the real screen. Reads whatever is visible; the text is
    /// only checked for being non-empty and never leaves the test.
    #[cfg(windows)]
    #[test]
    fn recognizes_text_on_the_live_screen() {
        let frame = super::super::capture::capture_frame().expect("capture");
        let text = recognize(&frame).expect("ocr");
        assert!(!text.trim().is_empty(), "expected some text on screen");
    }
}
