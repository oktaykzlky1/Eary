package com.asleyduo.app;

import android.Manifest;
import android.database.Cursor;
import android.provider.ContactsContract;
import android.telephony.TelephonyManager;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "EaryContacts",
    permissions = {
        @Permission(strings = { Manifest.permission.READ_CONTACTS }, alias = EaryContactsPlugin.CONTACTS)
    }
)
public class EaryContactsPlugin extends Plugin {
    static final String CONTACTS = "contacts";
    private static final int MAX_CONTACTS = 1000;

    @PluginMethod
    public void getContacts(PluginCall call) {
        if (getPermissionState(CONTACTS) != PermissionState.GRANTED) {
            requestPermissionForAlias(CONTACTS, call, "contactsPermissionCallback");
            return;
        }
        resolveContacts(call);
    }

    @PermissionCallback
    private void contactsPermissionCallback(PluginCall call) {
        if (getPermissionState(CONTACTS) != PermissionState.GRANTED) {
            call.reject("CONTACTS_PERMISSION_DENIED");
            return;
        }
        resolveContacts(call);
    }

    private void resolveContacts(PluginCall call) {
        try {
            JSArray contacts = new JSArray();
            String[] projection = new String[] {
                ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                ContactsContract.CommonDataKinds.Phone.NUMBER
            };
            String sortOrder = ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME + " COLLATE LOCALIZED ASC";
            Cursor cursor = getContext().getContentResolver().query(
                ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                projection,
                null,
                null,
                sortOrder
            );

            if (cursor != null) {
                try {
                    int nameIndex = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME);
                    int phoneIndex = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER);
                    int count = 0;
                    while (cursor.moveToNext() && count < MAX_CONTACTS) {
                        String phone = phoneIndex >= 0 ? cursor.getString(phoneIndex) : "";
                        if (phone == null || phone.trim().isEmpty()) continue;
                        String name = nameIndex >= 0 ? cursor.getString(nameIndex) : "";
                        JSObject contact = new JSObject();
                        contact.put("name", (name == null || name.trim().isEmpty()) ? "Kisi" : name.trim());
                        contact.put("phone", phone.trim());
                        contacts.put(contact);
                        count += 1;
                    }
                } finally {
                    cursor.close();
                }
            }

            JSObject result = new JSObject();
            result.put("contacts", contacts);
            result.put("countryIso", getCountryIso());
            call.resolve(result);
        } catch (SecurityException error) {
            call.reject("CONTACTS_PERMISSION_DENIED");
        } catch (Exception error) {
            call.reject("CONTACTS_OPEN_FAILED");
        }
    }

    private String getCountryIso() {
        try {
            TelephonyManager manager = (TelephonyManager) getContext().getSystemService(android.content.Context.TELEPHONY_SERVICE);
            String country = manager != null ? manager.getNetworkCountryIso() : "";
            return country == null ? "" : country.toUpperCase();
        } catch (Exception error) {
            return "";
        }
    }
}
