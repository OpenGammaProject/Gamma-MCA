/*

  Serial device connection, recording of spectra and serial console.

  Gamma MCA: free, open-source web-MCA for gamma spectroscopy
  2022, NuclearPhoenix.- Phoenix1747
  https://nuclearphoenix.xyz

*/

import { WebUSBSerialPort } from './external/webusbserial-min.js';

export class WebUSBSerial {
  private port: WebUSBSerialPort | undefined;
  private device: any;
  isOpen = false;
  
  static deviceFilters = [{ 'vendorId': 0x0403, 'productId': 0x6015 }]; // Filter FTDx Chips

  constructor(device: any) {
    this.device = device;
  }

  async sendString(value: string): Promise<void> {
     const enc = new TextEncoder(); 
     this.port?.send(enc.encode(`${value}\n`));
  }

  private buffer = new Uint8Array(102400); // Is 100kB enough?
  private pos = 0;
  
  async read(): Promise<Uint8Array> {
    if (this.pos === 0) {
      //await new Promise(resolve => setTimeout(resolve, 100));
      return new Uint8Array();
    }
    const ret = this.buffer.subarray(0, this.pos);
    this.pos = 0;
    return ret; 
  }

  serOptions = {
    overridePortSettings: true,
    baudrate: 115200,
  };

  async open(baudRate: number): Promise<void> { 
    this.serOptions.baudrate = baudRate;
    this.port = new WebUSBSerialPort(this.device, this.serOptions);

    this.pos = 0;
   
    this.port.connect(data => {
      //console.log(data);
      this.buffer.set(data,this.pos);
      this.pos += data.length;
    }, error => {
      console.error("Error receiving data!" + error)
      this.isOpen = false;
    });
    this.isOpen = true;
  }

  async close(): Promise<void> {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.port?.disconnect();
  }

  isThisPort(port: SerialPort | WebUSBSerialPort): boolean  {
    return (this.device === port);
  }

  getInfo(): string {
    return "WebUSB";
  }
}


export class WebSerial {
  private port: SerialPort;
  isOpen = false;

  constructor(port: SerialPort) {
    this.port = port;
  }

  isThisPort(port: SerialPort | WebUSBSerialPort): boolean {
    return this.port === port;
  }

  async sendString(value: string): Promise<void> {
    if (!this.isOpen) return;
      
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

  private reader: ReadableStreamDefaultReader | undefined;

  async read(): Promise<Uint8Array>{
    let ret = new Uint8Array();
    if(!this.isOpen) return ret;
  
    if(this.port.readable) {
      try {
        this.reader = this.port.readable.getReader();
        const {value} = await this.reader.read();
        if (value) {
          ret = value;
        } else {
          //await new Promise(resolve => setTimeout(resolve, 10));
        }
      } finally {
        this.reader?.releaseLock();
        this.reader = undefined;
        //await new Promise(resolve => setTimeout(resolve, 100));
      }
    } else {
      await this.close();
    }
    return ret;
  }

  serOptions: SerialOptions = { baudRate: 9600 } // Default 9600 baud rate

  async open(baudRate: number): Promise<void> {
    this.serOptions.baudRate = baudRate;
    await this.port.open(this.serOptions);
    this.isOpen = true;
  }

  async close(): Promise<void> {
    if (!this.isOpen) return;
    if (this.reader) await this.reader?.cancel();

    await this.port?.close();
    this.isOpen = false;
  }

  getInfo(): string {
    return `Id: 0x${this.port.getInfo().usbProductId?.toString(16)}`;
  }
}


import { DataOrder } from './main.js';

export class SerialManager {
  // SECTION: Serial Manager
  readonly port: WebSerial | WebUSBSerial;

  //private reader: ReadableStreamDefaultReader | undefined;
  private closed: Promise<void> | undefined;
  private recording = false;
  private onlyConsole = true;
  private startTime = 0;
  private timeDone = 0;

  static orderType: DataOrder = 'chron'; // Chronological data order;
  static baudRate = 9600; // Default 9600 baud rate

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

  constructor(port: WebSerial | WebUSBSerial) {
    this.port = port;
  }

  isThisPort(port: SerialPort | WebUSBSerialPort): boolean {
    return this.port.isThisPort(port);
  }

  /*

    SERIAL CONSOLE CONTROL

  */
  async sendString(value: string): Promise<void> {
    await this.port.sendString(value);
  }

  async showConsole(): Promise<void> {
    if (this.recording) return; // Port is already being read, nothing to do
    if (!this.port.isOpen) await this.port.open(SerialManager.baudRate); // Only try to open port if not open already

    this.recording = true;
    this.onlyConsole = true;
    this.closed = this.readUntilClosed();
  }

  async hideConsole(): Promise<void> {
    if (!this.recording || !this.onlyConsole) return; // Not recording or currently in a measurement so don't do anything...

    this.onlyConsole = false;
    this.recording = false;

    /*
    try {
      await this.port.close();
    } catch(err) {
      console.warn('Nothing to disconnect.', err);
    }
    */

    await this.closed;
  }
  /*

    RECORDING CONTROL

  */
  async stopRecord(): Promise<void> {
    if (!this.recording) return;

    this.recording = false;
    this.timeDone += performance.now() - this.startTime;

    /*
    try {
      await this.port.close();
    } catch(err) {
      console.warn('Nothing to disconnect.', err);
    }
    */

    await this.closed;
  }

  async startRecord(resume = false): Promise<void> {
    if (this.recording) return;
    if (!this.port.isOpen) await this.port.open(SerialManager.baudRate); // Only try to open port if not open already

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
    while (this.port.isOpen && this.recording) {
      const data = await this.port.read();
      if (data.length) this.addRaw(data); // Only submit non-empty arrays
    }
    await this.port.close();
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

      const stringArr = this.rawData.split(SerialManager.eolChar); //('\r\n');
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

      const stringArr = this.rawData.split('\n');

      stringArr.pop(); // Delete last entry to avoid counting unfinished transmissions
      //stringArr.shift(); // Delete first entry. !FIX SERIAL COMMUNICATION ERRORS!

      if (!stringArr.length) {
        if (this.rawData.length > this.maxHistLength) this.rawData = ''; // String too long without an EOL char, obvious error, delete.
        return;
      } else {
        for (const element of stringArr) {
          this.rawData = this.rawData.replace(element + '\n', '');
          const trimString = element.trim(); // Delete whitespace and line breaks

          if (!trimString.length || trimString.length >= this.maxHistLength) continue; // String is empty or longer than maxHistLength --> Invalid, disregard

          const stringHist = trimString.split(SerialManager.eolChar);
          stringHist.pop();

          if (stringHist.length !== SerialManager.adcChannels) continue; // Something is wrong with this histogram

          const numHist = stringHist.map(x => { // Parse ints from strings and check if NaN
            const parsed = parseInt(x);
            return isNaN(parsed) ? 0 : parsed;
          });

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
