import { window, QuickPickItem } from "vscode";
import { softwareGet, isResponseOk } from "../http/HttpClient";
import { getItem } from "../Util";
import Checkbox from "../model/checkbox";
import {
    displayProjectCommitsDashboardByRangeType,
    displayProjectCommitsDashboardByStartEnd,
} from "./ReportManager";

const moment = require("moment-timezone");

const dateFormat = "YYYY-MM-DD";

export class ProjectCommitManager {
    private static instance: ProjectCommitManager;

    private selectedStartTime: number = 0;
    private selectedEndTime: number = 0;
    private selectedRangeType: string = "";
    private local_start: number = 0;
    private local_end: number = 0;

    private items: any[] = [
        {
            label: "Custom",
            value: "custom",
        },
        {
            label: "Today",
            value: "today",
        },
        {
            label: "Yesterday",
            value: "yesterday",
        },
        {
            label: "This week",
            value: "currentWeek",
        },
        {
            label: "Last week",
            value: "lastWeek",
        },
        {
            label: "This month",
            value: "thisMonth",
        },
        {
            label: "Last month",
            value: "lastMonth",
        },
        {
            label: "Last 90 days",
            value: "lastNinetyDays",
        },
    ];

    private constructor() {
        //
    }

    static getInstance(): ProjectCommitManager {
        if (!ProjectCommitManager.instance) {
            ProjectCommitManager.instance = new ProjectCommitManager();
        }

        return ProjectCommitManager.instance;
    }

    resetDateRange() {
        this.selectedStartTime = 0;
        this.selectedEndTime = 0;
        this.selectedRangeType = "";
        this.local_start = 0;
        this.local_end = 0;
    }

    hasDateSelected() {
        return this.selectedRangeType || this.local_start;
    }

    async launchDailyReportMenuFlow() {
        this.resetDateRange();

        const pickItems: QuickPickItem[] = this.items.map((item) => {
            return {
                label: item.label,
                value: item.value,
            } as QuickPickItem;
        });

        const pick = await window.showQuickPick(pickItems, {
            placeHolder: "Select a date range",
        });

        if (pick && pick.label) {
            return this.launchProjectSelectionMenu(pick["value"]);
        }
        return null;
    }

    async launchViewProjectSummaryMenuFlow() {
        this.resetDateRange();

        const projectCheckboxes: Checkbox[] = await this.getAllProjects();
        return this.launchProjectSelectionMenu(projectCheckboxes);
    }

    // old date to project menu selection flow
    async launchProjectSummaryMenuFlow() {
        this.resetDateRange();

        await this.getSelectedDateRange();

        if (this.hasDateSelected()) {
            // date was selected, continue with showing the projects
            return this.launchViewProjectSummaryMenuFlow();
        }
    }

    async getSelectedDateRange() {
        const pickItems: QuickPickItem[] = this.items.map((item) => {
            return {
                label: item.label,
                value: item.value,
            } as QuickPickItem;
        });

        const pick = await window.showQuickPick(pickItems, {
            placeHolder: "Select a date range",
        });
        const local = moment().local();
        const offset_in_sec =
            moment.parseZone(local).utcOffset() * 60;

        if (pick && pick.label) {
            const val = pick["value"];
            if (val === "custom") {
                // show custom date range input
                const initialStartVal = moment()
                    .startOf("day")
                    .subtract(1, "day")
                    .format(dateFormat);
                const startDateText = await this.showDateInputBox(
                    initialStartVal,
                    dateFormat,
                    "starting"
                );
                if (startDateText) {
                    // START DATE (begin of day)
                    this.selectedStartTime = moment(startDateText, dateFormat)
                        .startOf("day")
                        .unix();

                    const endVal = moment
                        .unix(this.selectedStartTime)
                        .add(1, "day")
                        .format(dateFormat);
                    const endDateText = await this.showDateInputBox(
                        endVal,
                        dateFormat,
                        "ending"
                    );
                    if (endDateText) {
                        // END DATE (the end of the day)
                        this.selectedEndTime = moment(endDateText, dateFormat)
                            .endOf("day")
                            .unix();

                        // create the local start and end
                        this.local_start = this.selectedStartTime + offset_in_sec;
                        this.local_end = this.selectedEndTime + offset_in_sec;
                    }
                }
            } else {
                if (val === "lastNinetyDays") {
                    // create the local_start and local_end
                    this.local_start = moment().startOf("day").subtract(90, "days").unix() + offset_in_sec;
                    this.local_end = moment().startOf("day").unix() + offset_in_sec;
                } else {
                    // fetch the project checkboxes by range type (i.e. "yesterday")
                    this.selectedRangeType = val;
                }
            }
        }
    }

    async getSelectedProjects(checkboxes: Checkbox[]) {
        const pickItems: QuickPickItem[] = checkboxes.map((checkbox) => {
            return {
                value: checkbox.value,
                picked: checkbox.checked,
                label: checkbox.label,
                description: checkbox.text,
            } as QuickPickItem;
        });
        const picks = await window.showQuickPick(pickItems, {
            placeHolder: "Select one or more projects",
            ignoreFocusOut: false,
            matchOnDescription: true,
            canPickMany: true,
        });

        return picks;
    }

    async launchProjectSelectionMenu(projectCheckboxes: Checkbox[]) {
        const picks = await this.getSelectedProjects(projectCheckboxes);

        // will return an array of ... (value is the projectIds)
        // [{description, label, picked, value}]
        if (picks && picks.length) {
            if (!this.hasDateSelected()) {
                // launch the date selection menu
                await this.getSelectedDateRange();
                if (!this.hasDateSelected()) {
                    // the menu selection was cancelled
                    return;
                }
            }
            // go through the array and get the project IDs
            const projectIds = [];
            picks.forEach((item) => {
                projectIds.push(...item["value"]);
            });

            if (this.selectedRangeType) {
                displayProjectCommitsDashboardByRangeType(
                    this.selectedRangeType,
                    projectIds
                );
            } else if (this.local_start && this.local_end) {
                displayProjectCommitsDashboardByStartEnd(
                    this.local_start,
                    this.local_end,
                    projectIds
                );
            }
        }
        return null;
    }

    async getAllProjects(): Promise<Checkbox[]> {
        return await this.getProjectCheckboxesByQueryString();
    }

    async getProjectCheckboxesByStartEnd(start, end): Promise<Checkbox[]> {
        const qryStr = `?start=${start}&end=${end}`;
        return await this.getProjectCheckboxesByQueryString(qryStr);
    }

    async getProjectCheckboxesByRangeType(
        type = "lastWeek"
    ): Promise<Checkbox[]> {
        // fetch the projects from the backend
        const qryStr = `?timeRange=${type}`;
        return await this.getProjectCheckboxesByQueryString(qryStr);
    }

    async getProjectCheckboxesByQueryString(qryStr: string = ""): Promise<Checkbox[]> {
        // fetch the projects from the backend
        const api = `/projects${qryStr}`;
        const resp = await softwareGet(api, getItem("jwt"));
        let checkboxes: Checkbox[] = [];
        if (isResponseOk(resp)) {
            const projects = resp.data;
            let total_records = 0;
            if (projects && projects.length) {
                projects.forEach((p) => {
                    if (!p.coding_records) {
                        p["coding_records"] = 1;
                    }
                    total_records += p.coding_records;
                });

                let lineNumber = 0;
                for (let i = 0; i < projects.length; i++) {
                    const p = projects[i];
                    const name = p.project_name
                        ? p.project_name
                        : p.name
                            ? p.name
                            : "";
                    const projectIds = p.projectIds
                        ? p.projectIds
                        : p.id
                            ? [p.id]
                            : [];
                    if (name && projectIds.length) {
                        const percentage =
                            (p.coding_records / total_records) * 100;
                        // coding_records:419, project_name:"swdc-sublime-music-time", projectId:603593
                        const cb: Checkbox = new Checkbox();
                        cb.coding_records = p.coding_records;
                        cb.text = `(${percentage.toFixed(2)}%)`;
                        cb.label = name;
                        cb.checked = true;
                        cb.lineNumber = lineNumber;
                        cb.value = projectIds;
                        checkboxes.push(cb);
                        lineNumber++;
                    }
                }

                checkboxes.sort(
                    (a: Checkbox, b: Checkbox) =>
                        b.coding_records - a.coding_records
                );
            }
        }

        return checkboxes;
    }

    async showDateInputBox(
        value: string,
        placeHolder: string,
        datePrompt: string
    ) {
        return await window.showInputBox({
            value,
            placeHolder,
            prompt: `Please enter the ${datePrompt} date of the custom time range (YYYY-MM-DD) to continue..`,
            validateInput: (text) => {
                const isValid = moment(text, dateFormat, true).isValid();
                if (!isValid) {
                    return `Please enter a valid date to continue (${dateFormat})`;
                }
                const endTime = moment(text, dateFormat).unix();
                if (
                    this.selectedStartTime &&
                    endTime &&
                    this.selectedStartTime > endTime
                ) {
                    return `Please make sure the end date is after the start date`;
                }
                return null;
            },
        });
    }
}
