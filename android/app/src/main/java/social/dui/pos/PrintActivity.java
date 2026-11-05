package social.dui.pos;

import android.Manifest;
import android.app.Activity;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.util.Base64;
import android.widget.Toast;

import java.io.OutputStream;
import java.util.UUID;

/**
 * Prints raw ESC/POS bytes sent by the web app on a Bluetooth-classic printer, without any other app.
 *
 * The web page opens  intent:#Intent;action=social.dui.pos.PRINT;package=social.dui.pos;S.data=<base64url>;S.printer=<name>;end
 * This invisible activity decodes the bytes, writes them over SPP and closes, so the POS stays on screen.
 *
 * Default printer "InnerPrinter" is the built-in printer of SUNMI devices (V2 Pro, V2s, T2…), which SUNMI
 * exposes as an always-paired virtual Bluetooth printer (address 00:11:22:33:44:55). Any other printer
 * already paired in Android Bluetooth settings can be used by name.
 */
public class PrintActivity extends Activity {
    private static final UUID SPP = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private static final String SUNMI_ADDRESS = "00:11:22:33:44:55";
    private static final int REQ_BT = 7;

    private byte[] bytes;
    private String target;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Intent i = getIntent();
        String data = i.getStringExtra("data");
        target = i.getStringExtra("printer");
        if (data == null || data.isEmpty()) { done("Không có dữ liệu in"); return; }
        try {
            bytes = Base64.decode(data, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
        } catch (IllegalArgumentException e) {
            done("Dữ liệu in không hợp lệ");
            return;
        }
        if (Build.VERSION.SDK_INT >= 31 && checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] { Manifest.permission.BLUETOOTH_CONNECT }, REQ_BT);
            return;
        }
        printInBackground();
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        if (code == REQ_BT && results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) printInBackground();
        else done("Cần cho phép Bluetooth để in");
    }

    private void printInBackground() {
        new Thread(() -> {
            String err = null;
            try { print(); } catch (Exception e) { err = e.getMessage() != null ? e.getMessage() : e.toString(); }
            final String msg = err;
            runOnUiThread(() -> done(msg));
        }).start();
    }

    private void print() throws Exception {
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null) throw new Exception("Máy không có Bluetooth");
        if (!adapter.isEnabled()) throw new Exception("Hãy bật Bluetooth để in");
        boolean wantSunmi = target == null || target.isEmpty() || target.equalsIgnoreCase("InnerPrinter");
        BluetoothDevice device = null;
        for (BluetoothDevice d : adapter.getBondedDevices()) {
            String name = d.getName();
            if (wantSunmi ? (SUNMI_ADDRESS.equals(d.getAddress()) || "InnerPrinter".equals(name)) : target.equals(name)) { device = d; break; }
        }
        if (device == null) throw new Exception(wantSunmi ? "Không thấy máy in Sunmi (InnerPrinter)" : "Chưa ghép đôi máy in " + target + " trong Cài đặt Bluetooth");
        adapter.cancelDiscovery();
        BluetoothSocket socket = device.createRfcommSocketToServiceRecord(SPP);
        try {
            socket.connect();
            OutputStream out = socket.getOutputStream();
            for (int off = 0; off < bytes.length; off += 1024) {
                out.write(bytes, off, Math.min(1024, bytes.length - off));
                out.flush();
            }
            // Give the printer time to take the last bytes before the link closes.
            Thread.sleep(400 + bytes.length / 40);
        } finally {
            try { socket.close(); } catch (Exception ignored) { }
        }
    }

    private void done(String error) {
        if (error != null) Toast.makeText(this, "Lỗi in: " + error, Toast.LENGTH_LONG).show();
        finish();
        overridePendingTransition(0, 0);
    }
}
