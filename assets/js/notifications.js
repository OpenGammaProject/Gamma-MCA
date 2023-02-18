const notificationContents = {
    'updateInstalled': {
        type: 'info',
        icon: 'fa-solid fa-cloud-arrow-down fa-beat notification-beat-slow',
        header: 'Installed Update',
        body: 'An update has been found and installed. You must reload Gamma MCA for the changes to take effect. <br><br>' +
            '<em>You can also continue on this page without reloading for now.</em>'
    },
    'fileError': {
        type: 'danger',
        delay: 6000,
        icon: 'fas fa-exclamation-triangle fa-shake',
        header: 'File Error',
        body: 'Something went wrong, please reload and try again or report this issue.'
    },
    'settingError': {
        type: 'danger',
        delay: 4000,
        icon: 'fas fa-exclamation-triangle fa-shake',
        header: 'Settings Error',
        body: 'Something went wrong when trying to change a settings value, please reload and try again or report this issue.'
    },
    'settingType': {
        type: 'danger',
        delay: 4000,
        icon: 'fas fa-exclamation-triangle fa-shake',
        header: 'Wrong Datatype',
        body: 'A settings value cannot be changed because the input value datatype is not correct.'
    },
    'settingSuccess': {
        type: 'success',
        delay: 2000,
        icon: 'fas fa-check-circle fa-beat notification-beat-slow',
        header: 'Changed Setting',
        body: 'A settings value has been changed successfully.'
    },
    'serialConnectError': {
        type: 'danger',
        delay: 8000,
        icon: 'fas fa-exclamation-triangle fa-shake',
        header: 'Serial Connection Error',
        body: 'Could not connect to the serial device. Maybe the port is already in use?'
    },
    'miscSerialError': {
        type: 'danger',
        delay: 8000,
        icon: 'fas fa-exclamation-triangle fa-shake',
        header: 'Serial Error',
        body: 'Something went terribly wrong when trying to read from the serial port! Did you disconnect the device? Please try again.'
    },
    'serialDisconnect': {
        type: 'info',
        delay: 5000,
        icon: 'fas fa-info-circle fa-beat notification-beat-slow',
        header: 'Serial Disconnect',
        body: 'A serial device was removed.'
    },
    'autoStop': {
        type: 'info',
        icon: 'fas fa-info-circle fa-beat notification-beat-slow',
        header: 'Recording Stopped',
        body: 'Your set time-limit has run out. The recording has been automatically stopped. Changing this limit can be done in the settings.'
    },
    'npesError': {
        type: 'danger',
        delay: 6000,
        icon: 'fas fa-exclamation-triangle fa-shake',
        header: 'JSON Import Error',
        body: 'The file you uploaded is not formatted correctly. It does not validate the NPES JSON Schema!' +
            'For more information, please head to <a title="GitHub/NPES-JSON" class="link-light" href="https://github.com/OpenGammaProject/NPES-JSON" target="_blank">NPES-JSON</a>.' +
            '<br> <br>' +
            '<em>Tip: You can open the browser console to look at the exact errors.</em>'
    },
    'dataError': {
        type: 'danger',
        delay: 6000,
        icon: 'fas fa-exclamation-triangle fa-shake',
        header: 'File Error',
        body: 'Background and spectrum have a different number of channels. They must be same for this to work.'
    },
    'fileEmptyError': {
        type: 'warning',
        delay: 6000,
        icon: 'fas fa-exclamation-triangle fa-shake',
        header: 'No Data',
        body: 'You are trying to export a file, but there is not data to export. Please try again when there is data to export.'
    },
    'smaError': {
        type: 'danger',
        delay: 6000,
        icon: 'fas fa-exclamation-triangle fa-shake',
        header: 'SMA Error',
        body: 'SMA input is invalid. Input must be an <em>integer</em>!'
    },
    'calibrationApplyError': {
        type: 'danger',
        delay: 6000,
        icon: 'fas fa-exclamation-triangle fa-shake',
        header: 'Calibration Error',
        body: 'Cannot calibrate. Need at least two calibration points with valid numbers!'
    },
    'calibrationImportError': {
        type: 'danger',
        delay: 6000,
        icon: 'fas fa-exclamation-triangle fa-shake',
        header: 'Calibration Import Error',
        body: 'Something went wrong when importing the calibration. Please reload and try again or report this issue.'
    },
    'serialConnect': {
        type: 'info',
        delay: 5000,
        icon: 'fas fa-info-circle fa-beat notification-beat-slow',
        header: 'Serial Connect',
        body: 'Detected a new serial device.'
    },
    'welcomeMessage': {
        type: 'primary',
        icon: 'fas fa-radiation fa-beat notification-beat-slow',
        header: 'Welcome!',
        body: '<p>Thanks for using Gamma MCA, please report any bugs or issues on <a title="GitHub/Issues" class="link-light" href="https://github.com/OpenGammaProject/Gamma-MCA/issues" target="_blank"><small><i class="fa-solid fa-link"></i></small> GitHub/Issues</a>. Thank you.</p>' +
            '<p>By using the website and source code, you agree to the <a  title="GitHub/License" class="link-light" href="https://github.com/OpenGammaProject/Gamma-MCA/blob/main/LICENSE" target="_blank"><small><i class="fa-solid fa-link"></i></small> license</a>.</p>'
    },
    'saveMultipleAtOnce': {
        type: 'warning',
        delay: 8000,
        icon: 'fas fa-exclamation-triangle fa-shake',
        header: 'File Save Error',
        body: '<p>You tried to save (overwrite) multiple files at once. This is not supported due to the risk of data loss.</p>' +
            '<p>If you want to combine and save data from different files, please use the <code>Save As</code> function.</p>'
    }
};
export class Notification {
    toastElement;
    toast;
    toastContainer;
    constructor(type) {
        this.toastContainer = document.getElementById('toast-container');
        if (!this.toastContainer) {
            console.error('Toast container does not exist:', this.toastContainer);
            return;
        }
        const content = notificationContents[type];
        if (!content) {
            console.error('Not a valid notification:', type, content);
            return;
        }
        const root = document.createElement('div');
        root.className = `toast text-bg-${content.type}`;
        root.setAttribute('role', 'alert');
        root.setAttribute('aria-live', 'assertive');
        root.setAttribute('aria-atomic', 'true');
        if (content.delay) {
            root.setAttribute('data-bs-autohide', 'true');
            root.setAttribute('data-bs-delay', content.delay.toString());
        }
        else {
            root.setAttribute('data-bs-autohide', 'false');
        }
        const toastHeader = document.createElement('div');
        root.appendChild(toastHeader);
        toastHeader.className = 'toast-header';
        toastHeader.innerHTML = `<i class="${content.icon} me-2"></i> <strong class="me-auto">${content.header}</strong>` +
            '<button type="button" class="btn-close" data-bs-dismiss="toast" aria-label="Close"></button>';
        const toastBody = document.createElement('div');
        root.appendChild(toastBody);
        toastBody.className = 'toast-body';
        toastBody.innerHTML = content.body;
        this.toastContainer.appendChild(root);
        this.toastElement = root;
        this.toastElement.addEventListener('hidden.bs.toast', () => {
            if (this.toastElement)
                this.toastContainer?.removeChild(this.toastElement);
            this.toastElement = undefined;
            this.toast = undefined;
        });
        this.toast = new window.bootstrap.Toast(root);
        this.toast.show();
    }
}
//# sourceMappingURL=notifications.js.map