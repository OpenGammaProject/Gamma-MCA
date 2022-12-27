/*

  Serial Capability and Management

  Gamma MCA: free, open-source web-MCA for gamma spectroscopy
  2022, NuclearPhoenix.- Phoenix1747
  https://nuclearphoenix.xyz

*/

export class SerialData {
  maxSize: number;
  port: SerialPort | undefined; // Get the right data type
  adcChannels: number;
  maxLength: number;
  eolChar: string;
  readonly consoleMemory: number;
  private serInput: string;
  private rawData: string;
  private serData: number[];

  constructor() {
    this.maxSize = 100_000; // Maximum number of pulses/events to hold in the buffer
    this.port = undefined;
    this.adcChannels = 4096; // For OSC
    this.maxLength = 20; // Maximum number of characters for a valid string/number
    this.eolChar = ';'; // End of Line/Data character

    this.consoleMemory = 100_000;
    this.rawData = ''; // Raw String Input from Serial Reading
    this.serInput = '';
    this.serData = []; // Ready to use Integer Pulse Heights, could use a setget meh
  }

  addRaw(uintArray: Uint8Array, onlyConsole: boolean): void {
    if (this.serData.length > this.maxSize) { // Protect from overflow and crashes
      console.warn('Warning: Serial buffer is saturating!');
      return;
    }

    const string = new TextDecoder("utf-8").decode(uintArray); //String.fromCharCode(...uintArray);

    if (onlyConsole) {
      this.addRawData(string);
      console.log('onlkyfans')
      return;
    }

    this.rawData += string;

    let stringArr = this.rawData.split(this.eolChar); //('\r\n');
    stringArr.pop(); // Delete last entry to avoid counting unfinished transmissions
    stringArr.shift(); // Delete first entry. !FIX SERIAL COMMUNICATION ERRORS!

    if (stringArr.length <= 1) {
      if (this.rawData.length > this.maxLength) {
        this.rawData = ''; // String too long without an EOL char, obvious error, delete.
      }
      return;
    } else {
      for (const element of stringArr) {
        //this.rawData = this.rawData.replaceAll(element + '\r\n', '');
        this.rawData = this.rawData.replace(element + this.eolChar, '');
        const trimString = element.trim(); // Delete whitespace and line breaks

        if (trimString.length === 0 || trimString.length >= this.maxLength) {
          continue; // String is empty or longer than maxLength --> Invalid, disregard
        }

        const parsedInt = parseInt(trimString);

        if (isNaN(parsedInt)) {
          continue; // Not an integer -> throw away
        } else {
          if (parsedInt < 0 || parsedInt > this.adcChannels) { // Fixed value range. !FIX SERIAL COMMUNICATION ERRORS!
            continue;
          }
          this.serData.push(parsedInt);
        }
      }
    }

  }

  addRawData(string: string): void {
    this.serInput += string;

    if (this.serInput.length > this.consoleMemory) {
      //console.warn('Serial console log is out of memory, deleting old history...');

      const toBeDeleted = this.serInput.length - this.consoleMemory;
      this.serInput = this.serInput.slice(toBeDeleted);
    }
  }

  getRawData(): string {
    return this.serInput;
  }

  flushRawData(): void {
    this.serInput = '';
  }

  getData(): number[] {
    const copyArr = [...this.serData];
    this.serData = [];
    return copyArr;
  }

  flushData(): void {
    this.rawData = '';
    this.serData = [];
  }

  updateData(oldDataArr: number[], newDataArr: number[]): number[] {
    if(oldDataArr.length === 0) {
      oldDataArr = Array(this.adcChannels).fill(0);
    }

    for (const value of newDataArr) {
      oldDataArr[value] += 1;
    }
    return oldDataArr;
  }
}
