# Chrome Web Store privacy tab

Answers that match the code. Update them with the code, not the other way round.

## Single purpose

```
Replaces the new tab page with a page styled after the Wii U's Wara Wara Plaza that shows up to ten sites the user pins as shortcuts, with the user's Miis walking around them.
```

## Permission justifications

**storage**

```
Saves the sites the user pins, their names and colours, the user's settings and the Miis they add, and caches each pinned site's icon so new tabs open without fetching it again. Pins and settings sync through the user's own browser account; nothing is sent to the developer.
```

**favicon**

```
Shows Chrome's own cached icon for a pinned site when the site itself can't be reached.
```

**Host permissions (http://*/*, https://*/*)**

```
When the user pins a site, the extension fetches that one page to read its title, theme colour and icon, then keeps them locally. Users can pin any address, so it needs access to http and https pages. It also reads https://ankush.one/announcement.json, the developer's public news file, at most every six hours. No cookies or user data are sent with either request.
```

## Remote code

No. Everything runs from the package; `'wasm-unsafe-eval'` only lets the bundled WebAssembly Mii renderer run.

## Data usage

Tick none of the data types. Nothing about the user reaches the developer or anyone else: pins and settings sync through the user's own browser account, pinned sites' titles and icons are fetched from those sites and kept on the device, and the announcement request carries no cookies or data. If a reviewer asks for one anyway, Website content (the pinned sites' titles and icons) is the closest fit.

Certify all three:

- Not sold or transferred to third parties
- Not used for purposes unrelated to the single purpose
- Not used to determine creditworthiness or for lending

## Privacy policy

https://ankush.one/newtab-mii-plaza/privacy/
