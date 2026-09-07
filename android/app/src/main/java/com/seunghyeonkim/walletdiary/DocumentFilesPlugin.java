package com.seunghyeonkim.walletdiary;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.media.ExifInterface;
import android.net.Uri;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.tasks.Tasks;
import com.google.android.gms.tasks.Task;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;
import com.google.mlkit.vision.text.korean.KoreanTextRecognizerOptions;
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions;
import com.google.mlkit.vision.text.japanese.JapaneseTextRecognizerOptions;
import com.google.mlkit.vision.text.devanagari.DevanagariTextRecognizerOptions;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONArray;

@CapacitorPlugin(name = "DocumentFiles")
public final class DocumentFilesPlugin extends Plugin {
    private final ExecutorService executor = new ThreadPoolExecutor(1, 1, 0, TimeUnit.MILLISECONDS, new ArrayBlockingQueue<>(8));
    private final AtomicBoolean saving = new AtomicBoolean(false);

    private boolean execute(PluginCall call, Runnable work) {
        try { executor.execute(work); return true; }
        catch (RejectedExecutionException error) { call.reject("document-busy", error); return false; }
    }

    private void deleteTemporaryPdf(File file) {
        if (file.delete()) {
            File directory = file.getParentFile();
            if (directory != null) directory.delete();
        }
    }

    private void pruneOldPdfShares(File directory) throws Exception {
        File[] sessions = directory.listFiles();
        if (sessions == null) return;
        String parent = directory.getCanonicalPath();
        long oldest = System.currentTimeMillis() - TimeUnit.DAYS.toMillis(1);
        int inspected = 0;
        for (File session : sessions) {
            if (++inspected > 512) break;
            if (!session.getName().matches("[0-9a-f-]{36}") || session.lastModified() >= oldest || !session.isDirectory()) continue;
            if (!session.getCanonicalFile().getParentFile().getPath().equals(parent)) continue;
            File[] files = session.listFiles();
            if (files == null || files.length > 4) continue;
            for (File file : files) {
                if (file.isFile() && file.getCanonicalFile().getParentFile().equals(session.getCanonicalFile()) && file.lastModified() < oldest) file.delete();
            }
            session.delete();
        }
    }

    private File preparePdf(PluginCall call) throws Exception {
        String encoded = call.getString("base64", "");
        if (encoded.isEmpty() || encoded.length() > 53_333_336) throw new IllegalArgumentException("pdf-size");
        byte[] bytes = Base64.decode(encoded, Base64.DEFAULT);
        if (bytes.length > 40_000_000) throw new IllegalArgumentException("pdf-size");
        if (bytes.length < 5 || bytes[0] != '%' || bytes[1] != 'P' || bytes[2] != 'D' || bytes[3] != 'F' || bytes[4] != '-') throw new IllegalArgumentException("invalid-pdf");
        File directory = new File(getContext().getCacheDir(), "document-pdfs");
        if (!directory.exists() && !directory.mkdirs()) throw new IllegalStateException("cache");
        pruneOldPdfShares(directory);
        String filename = call.getString("filename", "wallet-diary.pdf").replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "-");
        if (filename.length() > 100) filename = filename.substring(0, 100);
        if (!filename.toLowerCase(java.util.Locale.ROOT).endsWith(".pdf")) filename += ".pdf";
        File sessionDirectory = new File(directory, UUID.randomUUID().toString());
        if (!sessionDirectory.mkdir()) throw new IllegalStateException("cache");
        File file = new File(sessionDirectory, filename);
        try (FileOutputStream stream = new FileOutputStream(file)) { stream.write(bytes); }
        // Do not retain a large base64 string while the system picker is open.
        call.getData().remove("base64");
        call.getData().put("_pdfSession", sessionDirectory.getName());
        call.getData().put("_pdfName", filename);
        return file;
    }

    @PluginMethod public void savePdf(PluginCall call) {
        if (!saving.compareAndSet(false, true)) { call.reject("save-busy"); return; }
        if (!execute(call, () -> {
            try {
                File file = preparePdf(call);
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("application/pdf");
                intent.putExtra(Intent.EXTRA_TITLE, file.getName());
                intent.putExtra(Intent.EXTRA_LOCAL_ONLY, true);
                getActivity().runOnUiThread(() -> {
                    try { startActivityForResult(call, intent, "pdfDestination"); }
                    catch (RuntimeException error) { saving.set(false); deleteTemporaryPdf(file); call.reject("save-picker", error); }
                });
            } catch (Exception error) { saving.set(false); call.reject("save-pdf", error); }
        })) saving.set(false);
    }

    @ActivityCallback private void pdfDestination(PluginCall call, ActivityResult result) {
        if (call == null) { saving.set(false); return; }
        String session = call.getString("_pdfSession", "");
        String name = call.getString("_pdfName", "");
        if (!session.matches("[0-9a-f-]{36}") || name.contains("/") || name.contains("\\") || name.isEmpty()) {
            saving.set(false); call.reject("save-state"); return;
        }
        File file = new File(new File(new File(getContext().getCacheDir(), "document-pdfs"), session), name);
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            deleteTemporaryPdf(file); saving.set(false); JSObject response = new JSObject(); response.put("saved", false); call.resolve(response); return;
        }
        Uri destination = result.getData().getData();
        if (!execute(call, () -> {
            try (FileInputStream input = new FileInputStream(file); OutputStream output = getContext().getContentResolver().openOutputStream(destination, "w")) {
                if (output == null) throw new IllegalStateException("destination");
                byte[] buffer = new byte[8192]; int count;
                while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                output.flush();
            } catch (Exception error) { call.reject("save-pdf", error); deleteTemporaryPdf(file); saving.set(false); return; }
            deleteTemporaryPdf(file); saving.set(false); JSObject response = new JSObject(); response.put("saved", true); call.resolve(response);
        })) { deleteTemporaryPdf(file); saving.set(false); }
    }

    @PluginMethod public void sharePdf(PluginCall call) {
        execute(call, () -> {
            try {
                File file = preparePdf(call);
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
                Intent send = new Intent(Intent.ACTION_SEND);
                send.setType("application/pdf");
                send.putExtra(Intent.EXTRA_STREAM, uri);
                send.putExtra(Intent.EXTRA_TITLE, file.getName());
                send.setClipData(ClipData.newUri(getContext().getContentResolver(), file.getName(), uri));
                send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                getActivity().runOnUiThread(() -> {
                    try {
                        Intent chooser = Intent.createChooser(send, file.getName());
                        chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        getActivity().startActivity(chooser);
                        JSObject response = new JSObject(); response.put("shared", true); call.resolve(response);
                    }
                    catch (RuntimeException error) { deleteTemporaryPdf(file); call.reject("share-pdf", error); }
                });
            } catch (Exception error) { call.reject("share-pdf", error); }
        });
    }

    @PluginMethod public void recognizeImage(PluginCall call) {
        execute(call, () -> {
            Bitmap bitmap = null; TextRecognizer recognizer = null;
            try {
                String encoded = call.getString("base64", "");
                if (encoded.isEmpty() || encoded.length() > 53_333_336) throw new IllegalArgumentException("image-size");
                byte[] bytes = Base64.decode(encoded, Base64.DEFAULT);
                if (bytes.length > 40_000_000) throw new IllegalArgumentException("image-size");
                call.getData().remove("base64");
                BitmapFactory.Options options = new BitmapFactory.Options(); options.inJustDecodeBounds = true;
                BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
                if (options.outWidth <= 0 || options.outHeight <= 0) throw new IllegalArgumentException("image-format");
                options.inSampleSize = 1;
                while (Math.max(options.outWidth, options.outHeight) / options.inSampleSize > 3000) options.inSampleSize *= 2;
                options.inJustDecodeBounds = false;
                bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
                if (bitmap == null) throw new IllegalArgumentException("image-format");
                int orientation = ExifInterface.ORIENTATION_NORMAL;
                try {
                    orientation = new ExifInterface(new ByteArrayInputStream(bytes)).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
                } catch (Exception ignored) {}
                Matrix matrix = new Matrix();
                switch (orientation) {
                    case ExifInterface.ORIENTATION_FLIP_HORIZONTAL: matrix.setScale(-1, 1); break;
                    case ExifInterface.ORIENTATION_ROTATE_180: matrix.setRotate(180); break;
                    case ExifInterface.ORIENTATION_FLIP_VERTICAL: matrix.setScale(1, -1); break;
                    case ExifInterface.ORIENTATION_TRANSPOSE: matrix.setRotate(90); matrix.postScale(-1, 1); break;
                    case ExifInterface.ORIENTATION_ROTATE_90: matrix.setRotate(90); break;
                    case ExifInterface.ORIENTATION_TRANSVERSE: matrix.setRotate(270); matrix.postScale(-1, 1); break;
                    case ExifInterface.ORIENTATION_ROTATE_270: matrix.setRotate(270); break;
                    default: break;
                }
                if (!matrix.isIdentity()) {
                    Bitmap oriented = Bitmap.createBitmap(bitmap, 0, 0, bitmap.getWidth(), bitmap.getHeight(), matrix, true);
                    if (oriented != bitmap) bitmap.recycle();
                    bitmap = oriented;
                }
                String language = call.getString("language", "en");
                if ("ko".equals(language)) recognizer = TextRecognition.getClient(new KoreanTextRecognizerOptions.Builder().build());
                else if ("zh".equals(language)) recognizer = TextRecognition.getClient(new ChineseTextRecognizerOptions.Builder().build());
                else if ("ja".equals(language)) recognizer = TextRecognition.getClient(new JapaneseTextRecognizerOptions.Builder().build());
                else if ("hi".equals(language)) recognizer = TextRecognition.getClient(new DevanagariTextRecognizerOptions.Builder().build());
                else recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
                Task<Text> task = recognizer.process(InputImage.fromBitmap(bitmap, 0));
                Text detected;
                try { detected = Tasks.await(task, 90, TimeUnit.SECONDS); }
                catch (TimeoutException | InterruptedException error) {
                    // A timeout does not cancel ML Kit's native image read.
                    // Keep the bitmap alive until the task actually completes.
                    Bitmap pendingBitmap = bitmap; TextRecognizer pendingRecognizer = recognizer;
                    bitmap = null; recognizer = null;
                    task.addOnCompleteListener(Runnable::run, ignored -> { pendingRecognizer.close(); pendingBitmap.recycle(); });
                    if (error instanceof InterruptedException) Thread.currentThread().interrupt();
                    throw error;
                }
                JSONArray lines = new JSONArray();
                for (Text.TextBlock block : detected.getTextBlocks()) for (Text.Line line : block.getLines()) {
                    if (lines.length() >= 10000) throw new IllegalArgumentException("text-limit");
                    android.graphics.Rect bounds = line.getBoundingBox();
                    JSObject row = new JSObject(); row.put("text", line.getText());
                    row.put("x", bounds == null ? 0 : bounds.left); row.put("y", bounds == null ? 0 : bounds.top); row.put("height", bounds == null ? 14 : bounds.height()); lines.put(row);
                }
                JSObject response = new JSObject(); response.put("lines", lines); call.resolve(response);
            } catch (Exception error) { call.reject("ocr-failed", error); }
            finally { if (bitmap != null) bitmap.recycle(); if (recognizer != null) recognizer.close(); }
        });
    }
    @Override protected void handleOnDestroy() { executor.shutdown(); super.handleOnDestroy(); }
}
