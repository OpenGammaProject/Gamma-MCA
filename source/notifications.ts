/*

  Create and auto-delete notifications via Bootstrap Toasts.

  Gamma MCA: free, open-source web-MCA for gamma spectroscopy
  2023, NuclearPhoenix.- Phoenix1747
  https://nuclearphoenix.xyz

*/

import Toast from 'bootstrap/js/dist/toast';

interface NotificationData {
	type: string;
	delay?: number;
	icon: string;
	header: string;
	body: string;
}

interface NotificationStorage {
	[key: string]: NotificationData | undefined;
}


const notificationContents: NotificationStorage = {
	'updateInstalled': {
		type: 'info',
		icon: 'fa-solid fa-cloud-arrow-down fa-beat animation-slow',
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
		icon: 'fas fa-check-circle fa-beat animation-slow',
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
		icon: 'fas fa-info-circle fa-beat animation-slow',
		header: 'Serial Disconnect',
		body: 'A serial device was removed.'
	},
	'autoStop': {
		type: 'info',
		icon: 'fas fa-info-circle fa-beat animation-slow',
		header: 'Recording Stopped',
		body: 'Your set time-limit has run out. The recording has been automatically stopped. Changing this limit can be done in the settings.'
	},
	/*
	'npesError': {
		type: 'danger',
		delay: 6000,
		icon: 'fas fa-exclamation-triangle fa-shake',
		header: 'JSON Import Error',
		body: 'The file you uploaded is not formatted correctly. It does not validate the NPES JSON Schema!' +
				'For more information, please head to <a title="GitHub/NPES-JSON" class="link-light link-underline-opacity-50 link-underline-opacity-100-hover" href="https://github.com/OpenGammaProject/NPES-JSON" target="_blank">NPES-JSON</a>.' +
				'<br> <br>' +
				'<em>Tip: You can open the browser console to look at the exact errors.</em>'
	},
	*/
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
		icon: 'fas fa-info-circle fa-beat animation-slow',
		header: 'Serial Connect',
		body: 'Detected a new serial device.'
	},
	'welcomeMessage': {
		type: 'primary',
		icon: 'fas fa-radiation fa-beat animation-slow',
		header: 'Welcome!',
		body: '<p>Thank you for using Gamma MCA, please report any bugs or issues on <a title="GitHub/Issues" class="link-light link-underline-opacity-50 link-underline-opacity-100-hover" href="https://github.com/OpenGammaProject/Gamma-MCA/issues" target="_blank"><small><i class="fa-solid fa-link"></i></small> GitHub/Issues</a>.</p>' +
				'<p>If you\'re new to this, you can have a look at the trailer on <a title="Youtube Trailer" class="link-light link-underline-opacity-50 link-underline-opacity-100-hover" href="https://www.youtube.com/watch?v=dkMhoUwDla0" target="_blank"><small><i class="fa-brands fa-youtube"></i></small> Youtube</a>.</p>' +
				'<p><a href="https://ko-fi.com/J3J61GLR3G" target="_blank"><img class="kofi-banner" height="36" src="assets/kofi_beige.png" border="0" alt="Buy Me a Coffee at ko-fi.com" /></a></a>'
	},
	'saveMultipleAtOnce': {
		type: 'warning',
		delay: 8000,
		icon: 'fas fa-exclamation-triangle fa-shake',
		header: 'File Save Error',
		body: '<p>You tried to save (overwrite) multiple files at once. This is not supported due to the risk of data loss.</p>' +
				'<p>If you want to combine and save data from different files, please use the <code>Save As</code> function.</p>'
	},
	'saveFile': {
		type: 'success',
		delay: 3000,
		icon: 'fas fa-check-circle fa-beat animation-slow',
		header: 'Saved File',
		body: 'Successfully saved data to the file system.'
	},
	'reportError': {
		type: 'warning',
		delay: 5000,
		icon: 'fas fa-exclamation-triangle fa-shake',
		header: 'Missing Data',
		body: 'Cannot generate a report since there is no data. Please try again when there is data to analyze.'
	},
};

export class ToastNotification {
	private toastElement: HTMLElement | undefined;
	private toast: Toast | undefined;
	private toastContainer: HTMLElement | null;

	constructor(type: string) {
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
		} else {
			root.setAttribute('data-bs-autohide', 'false');
		}

		const toastHeader = document.createElement('div');
		root.appendChild(toastHeader);
		toastHeader.className = 'toast-header';
		toastHeader.innerHTML = `<i class="${content.icon} me-2"></i> <strong class="me-auto">${content.header}</strong>` +
								`<small>${new Date().toLocaleString()}</small>` +
								'<button type="button" class="btn-close" data-bs-dismiss="toast" aria-label="Close"></button>';

		const toastBody = document.createElement('div');
		root.appendChild(toastBody);
		toastBody.className = 'toast-body';
		toastBody.innerHTML = content.body;

		this.toastContainer.appendChild(root);
		this.toastElement = root;

		/*
		this.toastElement.addEventListener('shown.bs.toast', () => {
			console.log('Hello there!');
		});
		*/

		this.toastElement.addEventListener('hidden.bs.toast', () => {
			if (this.toastElement) this.toastElement.remove();
			
			this.toastElement = undefined;
			this.toast = undefined;
		});

		this.toast = new Toast(root);
		this.toast.show();
	}

	/*
	show(): void {

	}

	hide(): void {

	}

	delete(): void {

	}
	*/
}


export function launchSysNotification(title: string, body: string, forceShow: boolean = false): void {
	// Launch a system notification using the Notifications API
	if (document.visibilityState === 'hidden' || forceShow) {
		new Notification(title, {
			lang: 'en-US', // Notification language code
			badge: '/assets/notifications/badge.png', // Notification image that shows if there isn't enough space for the notification text
			body: body, // Notification body text
			//image: '/assets/files/json.png', // Large image for notification, not avail in firefox
			icon: '/assets/notifications/icon.png' // Small image for notification
		});
	}
}
