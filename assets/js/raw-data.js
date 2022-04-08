/* File String in CSV format -> Array */

function RawData(valueIndex, delimiter = ',') {
  this.delimiter = delimiter;
  this.adcChannels = 4096; // For OSC
  this.valueIndex = valueIndex;
  this.fileType = valueIndex;

  this.tempValIndex = valueIndex;

  this.checkLines = function(value) {
    const values = value.split(this.delimiter);

    if (values.length == 1){ // Work-Around for files with only one column
      this.tempValIndex = 0;
    }

    return values.length > this.tempValIndex;
  };

  this.parseLines = function(value) {
    const values = value.split(this.delimiter);
    return parseFloat(values[this.tempValIndex].trim());
  };

  this.histConverter = function(dataArr) {
    if (this.fileType == 1) {
      return dataArr;
    }

    let xArray = Array(this.adcChannels).fill(0);

    for(const element of dataArr) {
      xArray[element] += 1;
    }
    return xArray;
  };

  this.csvToArray = function(data, fileEnding = 'csv') {
    this.tempValIndex = this.valueIndex; // RESET VALUE INDEX

    const allLines = data.split('\n');

    const dataLines = allLines.filter(this.checkLines, this);
    const cleanData = dataLines.map(this.parseLines, this);

    return this.histConverter(cleanData);
  };
}
