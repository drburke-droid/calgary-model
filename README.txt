Calgary - a working model of a city (1900-2026)
================================================

An interactive 3D toy model of Calgary. Drag the year slider (or press play) to watch the city grow;
drag to pan, scroll or pinch to zoom, right-drag or two-finger twist to tilt and turn. The Tour list
flies to each landmark at the right year.

Putting it on your website
--------------------------
1. Upload this whole folder (index.html, app.js and the data/ folder) to your web host, keeping the
   layout as is, e.g. https://yoursite.com/calgary-model/
2. Open https://yoursite.com/calgary-model/ - that's it. It must be served over http(s); opening
   index.html straight from your computer's disk will not load the data.
3. To place it inside another page, embed it:
   <iframe src="/calgary-model/" style="width:100%;height:80vh;border:0" allowfullscreen></iframe>

The page loads three.js (v0.160.0) from cdn.jsdelivr.net and the fonts from Google Fonts. Everything
else (about 17 MB of model data, ~14 MB compressed) is in data/. Most hosts compress .bin/.json files
automatically; if yours lets you, enable gzip or brotli for them.

The look: in browsers with WebGL2 (all current ones) the model is drawn like the film, with soft contact shadows,
a miniature-style depth of field focused on the centre of the view, and the film's colour grade. On slow devices
the contact shadows switch off by themselves. Add ?simple to the address to turn all of these effects off.

Credits that must stay visible: City of Calgary Open Data; road geometry (c) OpenStreetMap contributors
(ODbL). The full list is under "Sources & notes" in the page.

Calgary Vision Centre
---------------------
The Calgary Vision Centre line under the year (index.html, id "cvcLink"), the teal pin on Gulf Canada Square
(shown from 1998 on) and the text of its card (app.js, CVC_SUB) can be edited in those two files. The pin's
position comes from data/meta.json ("cvc"). Clicking the line or the pin flies the view to the clinic in 2026.
