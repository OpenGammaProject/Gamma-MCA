/* Serial Capability and Management */

function SerialData() {
  this.maxSize = 1000; // Maximum number of pulses/events to hold in the buffer
  this.port = null;
  this.adcChannels = 4096; // For OSC

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

    // Fail-Safe if the code below brakes
    if (this.rawData.length >= 500) {
      return;
    }

    const stringArr = this.rawData.split('\r\n');
    if (stringArr.length <= 1) {
      return;
    } else {
      for (element of stringArr) {
        this.rawData = this.rawData.replaceAll(element + '\r\n', '');

        if (isNaN(parseInt(element))) {
          continue; // Not an integer -> throw away
        } else {
          // Protect from overflow and crashes
          if (this.serData.length > this.maxSize) {
            return;
          }
          this.serData.push(parseInt(element));

          // OPTIONAL
          if (parseInt(element) < 100) {
            console.log('Invalid Event F');
          }
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
