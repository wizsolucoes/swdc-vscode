// Copyright (c) 2018 Software. All Rights Reserved.

// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import { window, ExtensionContext, StatusBarAlignment } from "vscode";
import {
    sendOfflineData,
    getUserStatus,
    sendHeartbeat,
    createAnonymousUser,
    serverIsAvailable,
    getSessionSummaryStatus,
    initializePreferences
} from "./lib/DataController";
import {
    showStatus,
    nowInSecs,
    getOffsetSecends,
    getVersion,
    softwareSessionFileExists,
    showOfflinePrompt,
    logIt,
    jwtExists,
    showLoginPrompt,
    getPluginName,
    getItem
} from "./lib/Util";
import { getHistoricalCommits } from "./lib/KpmRepoManager";
import { manageLiveshareSession } from "./lib/LiveshareManager";
import * as vsls from "vsls/vscode";
import { createCommands } from "./lib/command-helper";
import { setSessionSummaryLiveshareMinutes } from "./lib/OfflineManager";

let TELEMETRY_ON = true;
let statusBarItem = null;
let _ls = null;

let token_check_interval = null;
let liveshare_update_interval = null;
let historical_commits_interval = null;
let gather_music_interval = null;
let offline_data_interval = null;
let session_check_interval = null;
let kpmController = null;

const check_online_interval_ms = 1000 * 60 * 10;

let retry_counter = 0;
let secondary_window_activate_counter = 0;

export function isTelemetryOn() {
    return TELEMETRY_ON;
}

export function getStatusBarItem() {
    return statusBarItem;
}

export function deactivate(ctx: ExtensionContext) {
    if (_ls && _ls.id) {
        // the IDE is closing, send this off
        let nowSec = nowInSecs();
        let offsetSec = getOffsetSecends();
        let localNow = nowSec - offsetSec;
        // close the session on our end
        _ls["end"] = nowSec;
        _ls["local_end"] = localNow;
        manageLiveshareSession(_ls);
        _ls = null;
    }

    clearInterval(token_check_interval);
    clearInterval(liveshare_update_interval);
    clearInterval(historical_commits_interval);
    clearInterval(offline_data_interval);
    clearInterval(gather_music_interval);
    clearInterval(session_check_interval);

    // softwareDelete(`/integrations/${PLUGIN_ID}`, getItem("jwt")).then(resp => {
    //     if (isResponseOk(resp)) {
    //         if (resp.data) {
    //             console.log(`Uninstalled plugin`);
    //         } else {
    //             console.log(
    //                 "Failed to update Code Time about the uninstall event"
    //             );
    //         }
    //     }
    // });
}

export async function activate(ctx: ExtensionContext) {
    let windowState = window.state;
    // check if window state is focused or not and the
    // secondary_window_activate_counter is equal to zero
    if (!windowState.focused && secondary_window_activate_counter === 0) {
        // This window is not focused, call activate in 1 minute in case
        // there's another vscode editor that is focused. Allow that one
        // to activate right away.
        setTimeout(() => {
            secondary_window_activate_counter++;
            activate(ctx);
        }, 1000 * 5);
    } else {
        // check session.json existence
        const serverIsOnline = await serverIsAvailable();
        if (!softwareSessionFileExists() || !jwtExists()) {
            // session file doesn't exist
            // check if the server is online before creating the anon user
            if (!serverIsOnline) {
                if (retry_counter === 0) {
                    showOfflinePrompt(true);
                }
                // call activate again later
                setTimeout(() => {
                    retry_counter++;
                    activate(ctx);
                }, check_online_interval_ms);
            } else {
                // create the anon user
                const result = await createAnonymousUser(serverIsOnline);
                if (!result) {
                    if (retry_counter === 0) {
                        showOfflinePrompt(true);
                    }
                    // call activate again later
                    setTimeout(() => {
                        retry_counter++;
                        activate(ctx);
                    }, check_online_interval_ms);
                } else {
                    intializePlugin(ctx, true);
                }
            }
        } else {
            // has a session file, continue with initialization of the plugin
            intializePlugin(ctx, false);
        }
    }
}

export async function intializePlugin(
    ctx: ExtensionContext,
    createdAnonUser: boolean
) {
    logIt(`Loaded ${getPluginName()} v${getVersion()}`);

    let serverIsOnline = await serverIsAvailable();

    // get the user preferences whether it's music time or code time
    // this will also fetch the user and update loggedInCacheState if it's found
    await initializePreferences(serverIsOnline);

    // add the code time commands
    ctx.subscriptions.push(createCommands());

    let one_min_ms = 1000 * 60;

    // show the status bar text info
    setTimeout(() => {
        statusBarItem = window.createStatusBarItem(
            StatusBarAlignment.Right,
            10
        );
        // add the name to the tooltip if we have it
        const name = getItem("name");
        let tooltip = "Click to see more from Code Time";
        if (name) {
            tooltip = `${tooltip} (${name})`;
        }
        statusBarItem.tooltip = tooltip;
        statusBarItem.command = "codetime.softwarePaletteMenu";
        statusBarItem.show();

        showStatus("Code Time", null);
    }, 0);

    // show the local stats in 5 seconds
    setTimeout(() => {
        getSessionSummaryStatus();
    }, 1000 * 5);

    // every hour, look for repo members
    let hourly_interval_ms = 1000 * 60 * 60;

    // 35 min interval to check if the session file exists or not
    session_check_interval = setInterval(() => {
        periodicSessionCheck();
    }, 1000 * 60 * 35);

    // add the interval jobs

    // check on new commits once an hour
    historical_commits_interval = setInterval(async () => {
        if (window.state.focused) {
            let isonline = await serverIsAvailable();
            sendHeartbeat("HOURLY", isonline);
            getHistoricalCommits(isonline);
        }
    }, hourly_interval_ms);

    // every half hour, send offline data
    const half_hour_ms = hourly_interval_ms / 2;
    offline_data_interval = setInterval(() => {
        sendOfflineData();
    }, half_hour_ms);

    // in 2 minutes fetch the historical commits if any
    setTimeout(() => {
        getHistoricalCommits(serverIsOnline);
    }, one_min_ms * 2);

    // 10 minute interval tasks
    // check if the use has become a registered user
    // if they're already logged on, it will not send a request
    token_check_interval = setInterval(async () => {
        if (window.state.focused) {
            const name = getItem("name");
            // but only if checkStatus is true
            if (!name) {
                getUserStatus(serverIsOnline);
            }
        }
    }, one_min_ms * 10);

    // update liveshare in the offline kpm data if it has been initiated
    liveshare_update_interval = setInterval(async () => {
        if (window.state.focused) {
            updateLiveshareTime();
        }
    }, one_min_ms * 1);

    initializeLiveshare();

    // {loggedIn: true|false}
    await getUserStatus(serverIsOnline);

    if (createdAnonUser) {
        showLoginPrompt();

        if (kpmController) {
            kpmController.buildBootstrapKpmPayload();
        }
        // send a heartbeat that the plugin as been installed
        // (or the user has deleted the session.json and restarted the IDE)
        sendHeartbeat("INSTALLED", serverIsOnline);
    } else {
        // send a heartbeat
        sendHeartbeat("INITIALIZED", serverIsOnline);
    }

    // initiate kpm fetch by sending any offline data
    setTimeout(() => {
        sendOfflineData();
    }, 1000);
}

function handlePauseMetricsEvent() {
    TELEMETRY_ON = false;
    showStatus("Code Time Paused", "Enable metrics to resume");
}

function handleEnableMetricsEvent() {
    TELEMETRY_ON = true;
    showStatus("Code Time", null);
}

function updateLiveshareTime() {
    if (_ls) {
        let nowSec = nowInSecs();
        let diffSeconds = nowSec - parseInt(_ls["start"], 10);
        setSessionSummaryLiveshareMinutes(diffSeconds * 60);
    }
}

async function initializeLiveshare() {
    const liveshare = await vsls.getApi();
    if (liveshare) {
        // {access: number, id: string, peerNumber: number, role: number, user: json}
        logIt(`liveshare version - ${liveshare["apiVersion"]}`);
        liveshare.onDidChangeSession(async event => {
            let nowSec = nowInSecs();
            let offsetSec = getOffsetSecends();
            let localNow = nowSec - offsetSec;
            if (!_ls) {
                _ls = {
                    ...event.session
                };
                _ls["apiVesion"] = liveshare["apiVersion"];
                _ls["start"] = nowSec;
                _ls["local_start"] = localNow;
                _ls["end"] = 0;

                await manageLiveshareSession(_ls);
            } else if (_ls && (!event || !event["id"])) {
                updateLiveshareTime();
                // close the session on our end
                _ls["end"] = nowSec;
                _ls["local_end"] = localNow;
                await manageLiveshareSession(_ls);
                _ls = null;
            }
        });
    }
}

async function periodicSessionCheck() {
    const serverIsOnline = await serverIsAvailable();
    if (serverIsOnline && (!softwareSessionFileExists() || !jwtExists())) {
        // session file doesn't exist
        // create the anon user
        let createdJwt = await createAnonymousUser(serverIsOnline);
        if (createdJwt) {
            await getUserStatus(serverIsOnline);
            setTimeout(() => {
                sendOfflineData();
            }, 1000);
        }
    }
}
