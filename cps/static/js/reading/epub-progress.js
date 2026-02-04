/**
 * waits until queue is finished, meaning the book is done loading
 * @param callback
 */
function qFinished(callback){
    clearProgress();
    let bookLoadingInterval=setInterval(()=>{
        if (reader && reader.rendition && reader.rendition.q && reader.rendition.q.running === undefined) {
            clearInterval(bookLoadingInterval);
            callback();
        }
    },300
    )
}

function calculateProgress(){
    if (!reader || !reader.rendition || !reader.rendition.location || !reader.rendition.location.end) {
        return 0;
    }
    let data=reader.rendition.location.end;
    console.log("last location on page: " + data.cfi);
    console.log("epub.locations.length(): " + epub.locations.length());
    if (!data || !data.cfi || !epub || !epub.locations) {
        return 0;
    }
    let percentageFromCfi = epub.locations.percentageFromCfi(data.cfi);
    // console.log("percentageFromCfi: " + percentageFromCfi);
    let progress = Math.round(epub.locations.percentageFromCfi(data.cfi) * 100);
    // console.log("progress: " + progress);
    return progress;
}

function clearProgress() {
    if (progressDiv) {
        progressDiv.textContent="";
    }
}

function updateCurrentPosition() {
    let newPos = calculateProgress();
    if (progressDiv) {
        progressDiv.textContent = newPos ? newPos+"%" : "";
    }
    // Save progress to localStorage per book
    if (window.calibre && window.calibre.bookUrl && newPos && newPos > 0) {
        // Use bookUrl as a unique key, or use bookid if available
        console.log("Storing progress: " + newPos);
        let bookKey = window.calibre.bookUrl;
        localStorage.setItem("calibre.reader.progress." + bookKey, newPos);
    }
}

/**
 * Compute the user's progress within the CURRENT spine section (chapter),
 * complementing the book-wide calculateProgress() above. Backport of
 * janeczku/calibre-web#3370 (@ryan-c-scott) adapted to our split
 * epub-progress.js architecture.
 *
 * Returns a number 0..100, or null if not enough state to compute.
 * Uses the `epub` global's `locations._locations` (the array of CFIs
 * that our `epub.locations.generate()` call in qFinished() produced).
 * Note: upstream uses `reader.book.locations` because their PR runs
 * inside epub.js where `reader.book === epub`. Our progress logic
 * lives in a separate file and uses its own `epub` instance; the
 * reader has a different ePub instance whose locations are never
 * generated. We rely on the `epub` global throughout for consistency.
 *
 * The section's start CFI is the first locations-array entry whose
 * string contains the spine item's `cfiBase`; the section's end CFI
 * is the last such entry. We map
 * (current - sectionStart) / (sectionEnd - sectionStart) to 0..100.
 */
function calculateSectionProgress(){
    if (!reader || !reader.rendition || !reader.rendition.location) {
        return null;
    }
    const loc = reader.rendition.location;
    if (!loc.start || typeof loc.start.index !== "number" || !loc.start.cfi) {
        return null;
    }
    // Use the `epub` global throughout — that's the instance whose
    // locations we actually generate. `reader.book` is a separate ePub
    // instance whose `locations._locations` stays empty in our setup.
    if (!epub || !epub.spine || !epub.locations) {
        return null;
    }
    const spineItem = epub.spine.get(loc.start.index);
    if (!spineItem || !spineItem.cfiBase) {
        return null;
    }
    const allLocations = epub.locations._locations;
    if (!Array.isArray(allLocations) || allLocations.length === 0) {
        return null;
    }
    const baseCfi = spineItem.cfiBase;
    const sectionStartCfi = allLocations.find(cfi => cfi.includes(baseCfi));
    // findLast is ES2023 (Safari 15.4+, Chrome 97+, Firefox 104+); the
    // reader is a modern-browser surface anyway. Manual fallback via
    // reverse iteration kept tight in case the runtime is older.
    let sectionEndCfi;
    if (typeof allLocations.findLast === "function") {
        sectionEndCfi = allLocations.findLast(cfi => cfi.includes(baseCfi));
    } else {
        for (let i = allLocations.length - 1; i >= 0; i--) {
            if (allLocations[i].includes(baseCfi)) {
                sectionEndCfi = allLocations[i];
                break;
            }
        }
    }
    if (!sectionStartCfi || !sectionEndCfi) {
        return null;
    }
    if (sectionStartCfi === sectionEndCfi) {
        // Single-location section: by definition we've covered all of it.
        return 100;
    }
    const startNorm = epub.locations.percentageFromCfi(sectionStartCfi);
    const endNorm = epub.locations.percentageFromCfi(sectionEndCfi);
    const sectionSpan = endNorm - startNorm;
    if (!sectionSpan || sectionSpan <= 0) {
        return null;
    }
    const bookNorm = epub.locations.percentageFromCfi(loc.start.cfi);
    const sectionNorm = (bookNorm - startNorm) / sectionSpan;
    return Math.max(0, Math.min(100, Math.round(sectionNorm * 100)));
}

// register new event emitter locationchange that fires on urlchange
// source: https://stackoverflow.com/a/52809105/21941129
(() => {
    let oldPushState = history.pushState;
    history.pushState = function pushState() {
        let ret = oldPushState.apply(this, arguments);
        window.dispatchEvent(new Event('locationchange'));
        return ret;
    };

    let oldReplaceState = history.replaceState;
    history.replaceState = function replaceState() {
        let ret = oldReplaceState.apply(this, arguments);
        window.dispatchEvent(new Event('locationchange'));
        return ret;
    };

    window.addEventListener('popstate', () => {
        window.dispatchEvent(new Event('locationchange'));
    });
})();

window.addEventListener('locationchange',()=>{
    let newPos=calculateProgress();
    if (progressDiv) {
        // CW #3370 (@ryan-c-scott) backport: also show section progress
        // alongside the book percentage. Falls back to book-only if
        // section computation isn't ready yet (e.g. before
        // locations.generate() finishes).
        const sectionPct = calculateSectionProgress();
        if (sectionPct !== null) {
            progressDiv.textContent = sectionPct + "% (" + newPos + "% in book)";
        } else {
            progressDiv.textContent = newPos + "%";
        }
    }
    // CWA #1364 root-cause fix: only save to localStorage AFTER
    // `epub.locations.generate()` has resolved. Before that point,
    // `calculateProgress()` returns 0 because there are no locations
    // to map the current CFI against — saving that fake 0 wipes the
    // user's prior valid position. The qFinished/restore path then
    // reads localStorage=0, calls `display(cfiFromPercentage(0))`, and
    // the user lands at the beginning of the book even though they
    // were reading at e.g. 35% before. This is the headline symptom
    // in the upstream report: "opens at the correct cached position
    // then immediately snaps back to the beginning".
    if (window.calibre && window.calibre.bookUrl
            && epub && epub.locations
            && Array.isArray(epub.locations._locations)
            && epub.locations._locations.length > 0) {
        let bookKey = window.calibre.bookUrl;
        localStorage.setItem("calibre.reader.progress." + bookKey, newPos);
    }
    // If location changes, abort attempt to restore progress.
    clearInterval(restoreProgressInterval);
    if (!epub.locations.isReady) {
        clearProgress();
        return;
    }
    updateCurrentPosition();
});

var epub=ePub(calibre.bookUrl)

let progressDiv=document.getElementById("progress");

function restoreProgressWithLocations(locations) {
    // Restore progress: from localStorage if available, using kosync progress
    // as a fallback, with bookmark as last resort.
    if (window.calibre && window.calibre.bookUrl && reader && reader.rendition) {
        let bookKey = window.calibre.bookUrl;
        let savedProgress = parseInt(localStorage.getItem("calibre.reader.progress." + bookKey))
        let kosyncProgress = parseFloat(window.calibre.kosyncPercent);
        console.log("savedProgress: " + savedProgress);
        console.log("kosyncProgress: " + kosyncProgress);
        let progress = savedProgress || kosyncProgress
        console.log("About to advance to progress: " + progress);
        let percentage = progress && (parseInt(progress, 10) / 100);
        console.log("Progress percentage is: " + percentage);
        let percentageCfi = locations.cfiFromPercentage(percentage);
        console.log("percentageCfi: " + percentageCfi);
        console.log("bookmark: " + window.calibre.bookmark);
        let cfi = (percentageCfi !== -1 && percentageCfi) || window.calibre.bookmark;
        console.log("Advancing to cfi: " + cfi);
        if (cfi && cfi.length > 0) {
            reader.rendition.display(cfi);
            console.log("Advanced to cfi: " + cfi);
        }
        window.dispatchEvent(new Event('locationchange'))
    }
}

// Track attempt to restore progress
let restoreProgressInterval = null;

qFinished(()=>{
    if (!epub || !epub.locations) {
        return;
    }
    if (epub.locations.length() == 0) {
        epub.locations.generate().then(()=> {
            console.log("Locations generated promise resolved.");
            // The `epub.locations.generate()` promise resolves before the locations
            // have completed being added, so we must poll until they are all
            // there.
            let attempt = 0;
            let pollingFrequency = 100;
            let retryAfter = 10;
            let subsequentRetryAfter = 50;
            epub.locations.isReady = false;
            restoreProgressInterval=setInterval(()=> {
                attempt = attempt + 1;
                if (progressDiv) {
                    progressDiv.textContent="Restoring Position [" + (attempt % 2 == 0 ? "/" : "\\") + "]"
                }
                let count = epub.locations.length();
                let total = epub.locations.total;
                console.log("count and total: " + count + " (" + total + ")");
                // Handle off-by-one issue with total
                let isReady = count > 0 && (count - total == 1);
                if (isReady) {
                    console.log("Locations now available...")
                    epub.locations.isReady = true;
                    clearInterval(restoreProgressInterval);
                    restoreProgressWithLocations(epub.locations);
                } else {
                    // Under some conditions, `epub.locations.generate()` appears
                    // not to start adding locations at all, so try it again if
                    // we have not seen any progress after a few attempts.
                    if (count == 0 && (attempt % retryAfter) == 0) {
                        console.log("Locations not available and still empty, regenerating...")
                        // Don't want to unnecessarily attempt to re-generate too often.
                        retryAfter = subsequentRetryAfter;
                        epub.locations.generate();
                    }
                }
            }, pollingFrequency);
        });
    } else {
        console.log("Locations already generated");
        restoreProgressWithLocations(epub.locations);
    }
})
