import { getStatusBarItem } from "../extension";
import * as spotify from "spotify-node-applescript";
import * as itunes from "itunes-node-applescript";

const fs = require("fs");
const os = require("os");
const crypto = require("crypto");

const alpha = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

let lastStatusMsg = "";

export function setItem(key, value) {
    const jsonObj = getSoftwareSessionAsJson();
    jsonObj[key] = value;

    const content = JSON.stringify(jsonObj);

    const sessionFile = getSoftwareSessionFile();
    fs.writeFileSync(sessionFile, content, err => {
        if (err)
            console.log(
                "Software.com: Error writing to the Software session file: ",
                err.message
            );
    });
}

export function getItem(key) {
    const jsonObj = getSoftwareSessionAsJson();

    return jsonObj[key] || null;
}

export function showErrorStatus() {
    let fullMsg = `$(${"alert"}) ${"Software.com"}`;
    showStatus(
        fullMsg,
        "To see your coding data in Software.com, please log in to your account."
    );
}

export function showStatus(fullMsg, tooltip) {
    if (!tooltip) {
        getStatusBarItem().tooltip = "Click to see more from Software.com";
    } else {
        getStatusBarItem().tooltip = tooltip;
    }
    lastStatusMsg = fullMsg;
    getStatusBarItem().text = fullMsg;
}

// process.platform return the following...
//   -> 'darwin', 'freebsd', 'linux', 'sunos' or 'win32'
export function isWindows() {
    return process.platform.indexOf("win32") !== -1;
}

export function isMac() {
    return process.platform.indexOf("darwin") !== -1;
}

export function getSoftwareDir() {
    const homedir = os.homedir();
    let softwareDataDir = homedir;
    if (isWindows()) {
        softwareDataDir += "\\.software";
    } else {
        softwareDataDir += "/.software";
    }

    if (!fs.existsSync(softwareDataDir)) {
        fs.mkdirSync(softwareDataDir);
    }

    return softwareDataDir;
}

export function getSoftwareSessionFile() {
    let file = getSoftwareDir();
    if (isWindows()) {
        file += "\\session.json";
    } else {
        file += "/session.json";
    }
    return file;
}

export function getSoftwareDataStoreFile() {
    let file = getSoftwareDir();
    if (isWindows()) {
        file += "\\data.json";
    } else {
        file += "/data.json";
    }
    return file;
}

export function getSoftwareSessionAsJson() {
    let data = null;

    const sessionFile = getSoftwareSessionFile();
    if (fs.existsSync(sessionFile)) {
        const content = fs.readFileSync(sessionFile).toString();
        if (content) {
            data = JSON.parse(content);
        }
    }
    return data ? data : {};
}

export function nowInSecs() {
    return Math.round(Date.now() / 1000);
}

export function storePayload(payload) {
    fs.appendFile(
        getSoftwareDataStoreFile(),
        JSON.stringify(payload) + os.EOL,
        err => {
            if (err)
                console.log(
                    "Software.com: Error appending to the Software data store file: ",
                    err.message
                );
        }
    );
}

export function randomCode() {
    return crypto
        .randomBytes(16)
        .map(value =>
            alpha.charCodeAt(Math.floor((value * alpha.length) / 256))
        )
        .toString();
}

export function deleteFile(file) {
    // if the file exists, get it
    if (fs.existsSync(file)) {
        fs.unlinkSync(file);
    }
}

export async function getCurrentMusicTrackId() {
    // const spotifyState = await getSpotifyStatePromise();
    let trackInfo = {};

    if (await getSpotifyRunningPromise()) {
        const spotifyTrack = await getSpotifyTrackPromise();
        if (spotifyTrack) {
            trackInfo = {
                id: spotifyTrack.id,
                name: spotifyTrack.name,
                artist: spotifyTrack.artist
            };
        }
    } else if (await isItunesRunningPromise()) {
        const itunesTrackInfo = await getItunesTrackPromise();
        if (itunesTrackInfo) {
            trackInfo = {
                id: itunesTrackInfo.id,
                name: itunesTrackInfo.name,
                artist: itunesTrackInfo.artist
            };
        }
    }

    return trackInfo;
}

/**
 * returns true or an error
 */
function getSpotifyRunningPromise() {
    return new Promise<boolean>((resolve, reject) => {
        spotify.isRunning((err, isRunning) => {
            if (err) {
                reject(err);
            } else {
                resolve(isRunning);
            }
        });
    });
}

/**
 * returns i.e. {position:75, state:"playing", track_id:"spotify:track:4dHuU8wSvtek4sxRGoDLpf", volume:100}
 */
function getSpotifyStatePromise() {
    return new Promise<spotify.State>((resolve, reject) => {
        spotify.getState((err, state) => {
            if (err) {
                reject(err);
            } else {
                resolve(state);
            }
        });
    });
}

/**
 * returns i.e.
 * track = {
        artist: 'Bob Dylan',
        album: 'Highway 61 Revisited',
        disc_number: 1,
        duration: 370,
        played count: 0,
        track_number: 1,
        starred: false,
        popularity: 71,
        id: 'spotify:track:3AhXZa8sUQht0UEdBJgpGc',
        name: 'Like A Rolling Stone',
        album_artist: 'Bob Dylan',
        artwork_url: 'http://images.spotify.com/image/e3d720410b4a0770c1fc84bc8eb0f0b76758a358',
        spotify_url: 'spotify:track:3AhXZa8sUQht0UEdBJgpGc' }
    }
 */
function getSpotifyTrackPromise() {
    return new Promise<spotify.State>((resolve, reject) => {
        spotify.getTrack((err, track) => {
            if (err) {
                reject(err);
            } else {
                resolve(track);
            }
        });
    });
}

function isItunesRunningPromise() {
    return new Promise((resolve, reject) => {
        itunes.isRunning((err, isRunning) => {
            if (err) {
                reject(err);
            } else {
                resolve(isRunning);
            }
        });
    });
}

/**
 * returns an array of data, i.e.
 * 0:"Dance"
    1:"Martin Garrix"
    2:"High on Life (feat. Bonn) - Single"
    3:4938 <- is this the track ID?
    4:375
    5:"High on Life (feat. Bonn)"
    6:"3:50"
 */
async function getItunesTrackPromise() {
    return new Promise<itunes.any>((resolve, reject) => {
        itunes.track((err, track) => {
            if (err) {
                reject(err);
            } else {
                let trackInfo = {};
                if (track) {
                    if (track.length >= 1) {
                        trackInfo["artist"] = track[1];
                    }
                    if (track.length >= 3) {
                        trackInfo["id"] = track[3];
                    }
                    if (track.length >= 5) {
                        trackInfo["name"] = track[5];
                    }
                }
                resolve(trackInfo);
            }
        });
    });
}