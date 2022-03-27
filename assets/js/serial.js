/* Serial Capability and Management */

function SerialData() {
  this.maxSize = 10000; // Maximum number of pulses/events to hold in the buffer
  this.port = null;
  this.adcChannels = 4096; // For OSC
  this.maxLength = 20; // Maximum number of characters for a valid string/number

  this.rawData = ""; // Raw String Input from Serial Reading
  this.serData = []; // Ready to use Integer Pulse Heights, could use a setget meh

  let generateEmptyArr = function(len) {
    let arr = [];
    for(let i = 0; i < len; i++) {
      arr.push(0);
    }
    return arr;
  };

  this.addRaw = function(uintArray) {
    const string = String.fromCharCode(...uintArray);

    this.rawData += string;

    let stringArr = this.rawData.split(';'); //('\r\n');
    stringArr.pop(); // Delete last entry to avoid counting unfinished transmissions

    if (stringArr.length <= 1) {
      if (this.rawData.length > this.maxLength) {
        this.rawData = ""; // String too long without an EOL char, obvious error, delete.
      }
      return;
    } else {
      for (element of stringArr) {
        //this.rawData = this.rawData.replaceAll(element + '\r\n', '');
        this.rawData = this.rawData.replace(element + ';', '');
        const trimString = element.trim(); // Delete whitespace and line breaks

        if (trimString.length == 0 || trimString.length >= this.maxLength) {
          continue; // String is empty or longer than maxLength --> Invalid, disregard
        }

        const parsedInt = parseInt(trimString);

        if (isNaN(parsedInt)) {
          continue; // Not an integer -> throw away
        } else {
          // Protect from overflow and crashes
          if (this.serData.length > this.maxSize) {
            return;
          }
          if (parsedInt < 0) {
            continue;
          }
          this.serData.push(parsedInt);
        }
      }
    }

  };

  this.getData = function() {
    const copyArr = [...this.serData];
    this.serData = [];
    return copyArr;
  };

  this.flushData = function() {
    this.rawData = "";
    this.serData = [];
  };

  this.updateData = function(oldDataArr, newDataArr) {
    if(oldDataArr.length == 0) {
      oldDataArr = generateEmptyArr(this.adcChannels);
    }

    for (value of newDataArr) {
      oldDataArr[value] += 1;
    }
    return oldDataArr;
  };
}
