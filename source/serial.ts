/*

  Serial Capability and Management

  Gamma MCA: free, open-source web-MCA for gamma spectroscopy
  2022, NuclearPhoenix.- Phoenix1747
  https://nuclearphoenix.xyz

  TODO: Check if serial port is already open and ok when sending

*/

import { DataOrder } from './main.js';

export class SerialManager {
  // SECTION: Serial Manager
  readonly port: SerialPort;

  private reader: ReadableStreamDefaultReader | undefined;
  private closed: Promise<void> | undefined;
  private recording = false;
  private onlyConsole = true;
  private startTime = 0;
  private timeDone = 0;

  static orderType: DataOrder = 'chron'; // Chronological data order;
  static serOptions: SerialOptions = { baudRate: 9600 } // Default 9600 baud rate

  // SECTION: Serial Data
  private consoleMemory = 1_000_000;
  private rawConsoleData = '';
  private rawData = ''; // Raw String Input from Serial Reading
  private maxHistLength = 2**18 * 2 * 10; // Maximum number of characters for a valid histogram string/number
  private maxLength = 20; // Maximum number of characters for a valid string/number
  private bufferPulseData = <number[]>[]; // Ready to use Integer Pulse Heights, could use a setget meh
  private baseHist = <number[]>[]; // Baseline histogram that will be subtracted from every other newer hist

  static maxSize = 200_000; // Maximum number of pulses/events to hold in the buffer
  static adcChannels = 4096; // Default 12-bit ADC
  static eolChar = ';'; // End of Line/Data character

  constructor(port: SerialPort) {
    this.port = port;
  }

  /*

    SERIAL CONSOLE CONTROL

  */
  async sendString(value: string): Promise<void> {
    // Maybe also check if the serial port is open?
    if (!this.port?.writable) throw 'Port is not writable!';

    const textEncoder = new TextEncoderStream();
    const writer = textEncoder.writable.getWriter();
    const writableStreamClosed = textEncoder.readable.pipeTo(this.port.writable);

    writer.write(value.trim() + '\n');
    //writer.write('\x03\n');

    //writer.releaseLock();
    await writer.close();
    await writableStreamClosed;
  }

  async showConsole(): Promise<void> {
    if (this.recording) return; // Port is already being read, nothing to do

    await this.port.open(SerialManager.serOptions); // Baud-Rate optional

    this.recording = true;
    this.onlyConsole = true;
    this.closed = this.readUntilClosed();
  }

  async hideConsole(): Promise<void> {
    if (!this.recording || !this.onlyConsole) return // Not recording or currently in a measurement so don't do anything...

    this.onlyConsole = false;
    this.recording = false;

    try {
      this.reader?.cancel();
    } catch(err) {
      console.warn('Nothing to disconnect.', err);
    }

    await this.closed;
  }
  /*

    RECORDING CONTROL

  */
  async stopRecord(): Promise<void> {
    if (!this.recording) return;

    this.recording = false;
    this.timeDone += performance.now() - this.startTime;

    try {
      this.reader?.cancel();
    } catch(err) {
      console.warn('Nothing to disconnect.', err);
    }

    await this.closed;
  }

  async startRecord(resume = false): Promise<void> {
    if (this.recording) return;

    await this.port.open(SerialManager.serOptions); // Baud-Rate optional

    if (!resume) {
      //this.flushRawData();
      this.flushData();
      this.clearBaseHist();
      this.timeDone = 0;
    }

    this.startTime = performance.now();

    this.recording = true;
    this.onlyConsole = false;
    this.closed = this.readUntilClosed();
  }

  private async readUntilClosed(): Promise<void> {
    while (this.port?.readable && this.recording) {
      try {
        this.reader = this.port.readable.getReader();

        while (true) {
          const {value, done} = await this.reader.read();
          if (value) this.addRaw(value); // value is a Uint8Array.
          if (done) {
            // reader.cancel() has been called.
            break;
          }
        }
      } finally {
        // Allow the serial port to be closed later.
        this.reader?.releaseLock();
        this.reader = undefined;
      }
    }
    await this.port?.close();
  }
  /*

    DATA CONTROL

  */
  private addRaw(uintArray: Uint8Array): void {
    const string = new TextDecoder("utf-8").decode(uintArray); //String.fromCharCode(...uintArray);
    this.rawConsoleData += string;

    if (this.rawConsoleData.length > this.consoleMemory) {
      //console.warn('Serial console log is out of memory, deleting old history...');
      this.rawConsoleData = this.rawConsoleData.slice(this.rawConsoleData.length - this.consoleMemory);
    }
    if (this.onlyConsole) return;

    if (this.bufferPulseData.length > SerialManager.maxSize) { // Protect from overflow and crashes
      console.warn('Warning: Serial buffer is saturating!');
      return;
    }
    this.rawData += string;

    if (SerialManager.orderType === 'chron') { // CHRONOLOGICAL EVENTS

      let stringArr = this.rawData.split(SerialManager.eolChar); //('\r\n');
      stringArr.pop(); // Delete last entry to avoid counting unfinished transmissions
      stringArr.shift(); // Delete first entry. !FIX SERIAL COMMUNICATION ERRORS!

      if (stringArr.length <= 1) {
        if (this.rawData.length > this.maxLength) this.rawData = ''; // String too long without an EOL char, obvious error, delete.
        return;
      } else {
        for (const element of stringArr) {
          //this.rawData = this.rawData.replaceAll(element + '\r\n', '');
          this.rawData = this.rawData.replace(element + SerialManager.eolChar, '');
          const trimString = element.trim(); // Delete whitespace and line breaks

          if (!trimString.length || trimString.length >= this.maxLength) continue; // String is empty or longer than maxLength --> Invalid, disregard

          const parsedInt = parseInt(trimString);

          if (isNaN(parsedInt)) {
            continue; // Not an integer -> throw away
          } else {
            if (parsedInt < 0 || parsedInt > SerialManager.adcChannels) continue; // Fixed value range. !FIX SERIAL COMMUNICATION ERRORS!
            this.bufferPulseData.push(parsedInt);
          }
        }
      }

    } else if (SerialManager.orderType === 'hist') { // HISTOGRAM DATA

      let stringArr = this.rawData.split('\r\n');

      stringArr.pop(); // Delete last entry to avoid counting unfinished transmissions
      //stringArr.shift(); // Delete first entry. !FIX SERIAL COMMUNICATION ERRORS!

      if (!stringArr.length) {
        if (this.rawData.length > this.maxHistLength) this.rawData = ''; // String too long without an EOL char, obvious error, delete.
        return;
      } else {
        for (const element of stringArr) {
          this.rawData = this.rawData.replace(element + '\r\n', '');
          const trimString = element.trim(); // Delete whitespace and line breaks

          if (!trimString.length || trimString.length >= this.maxHistLength) continue; // String is empty or longer than maxHistLength --> Invalid, disregard

          const stringHist = trimString.split(SerialManager.eolChar);
          stringHist.pop();

          if (stringHist.length !== SerialManager.adcChannels) continue; // Something is wrong with this histogram

          let numHist = stringHist.map(x => parseInt(x));
          numHist = numHist.map(item => isNaN(item) ? 0 : item);

          if (!this.baseHist.length) {
            this.baseHist = numHist;
            this.startTime = performance.now(); // Reset because we only acquired the differential comparison hist
            return;
          }

          const diffHist = numHist.map((item, index) => item - this.baseHist[index]);

          if (!this.bufferPulseData.length) this.bufferPulseData = Array(SerialManager.adcChannels).fill(0);

          for (const index in this.bufferPulseData) {
            this.bufferPulseData[index] += diffHist[index];
          }

          this.baseHist = numHist; // Update baseline to the current array
        }
      }
    }
  }
  /*

    DATA INTERFACING

  */
  private flushData(): void {
    this.rawData = '';
    this.bufferPulseData = [];
  }

  private clearBaseHist(): void {
    this.baseHist = [];
  }

  flushRawData(): void {
    this.rawConsoleData = '';
  }

  getRawData(): string {
    return this.rawConsoleData;
  }

  getData(): number[] {
    const copyArr = [...this.bufferPulseData];
    this.bufferPulseData = [];
    return copyArr;
  }

  getTime(): number {
    return (this.recording ? (performance.now() - this.startTime + this.timeDone) : this.timeDone);
  }
}
