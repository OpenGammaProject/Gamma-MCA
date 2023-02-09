/*
	WebUSB FTDI Driver v0.01a
	(C) 2020 Shaped Technologies (Jai B.)

	GPL v2 free for personal use / commercial or closed source use requires commercial license - contact us.

	This wouldn't have been possible without the Linux driver, so shoutout to the developers of that!

	Data Transfer Efficiency / Bulk Transfers Technical Note
	https://www.ftdichip.com/Support/Documents/TechnicalNotes/TN_103_FTDI_USB_Data_Transfer_Efficiency(FT_000097).pdf

	Chipset feature comparison:
	https://www.ftdichip.com/Support/Documents/TechnicalNotes/TN_107%20FTDI_Chipset_Feature_Comparison.pdf

	https://www.ftdichip.com/Support/Documents/AppNotes/AN232B-04_DataLatencyFlow.pdf

*/

/*

USB_SETUP_HOST_TO_DEVICE	0x00	Transfer direction: host to device
USB_SETUP_DEVICE_TO_HOST	0x80	Transfer direction: device to host
USB_SETUP_TYPE_STANDARD		0x00	Type: standard
USB_SETUP_TYPE_CLASS		0x20	Type: class
USB_SETUP_TYPE_VENDOR		0x40	Type: vendor
USB_SETUP_RECIPIENT_DEVICE	0x00	Recipient: device
USB_SETUP_RECIPIENT_INTERFACE	0x01	Recipient: interface
USB_SETUP_RECIPIENT_ENDPOINT	0x02	Recipient: endpoint
USB_SETUP_RECIPIENT_OTHER	0x03	Recipient: other

*/

export class WebUSBSerialPort {
	/* Commands */
	#FTDI_SIO_RESET 				= 0x00; /* Reset the port */
	#FTDI_SIO_MODEM_CTRL			= 0x01; /* Set the modem control register */
	#FTDI_SIO_SET_FLOW_CTRL 		= 0x02; /* Set flow control register */
	#FTDI_SIO_SET_BAUD_RATE 		= 0x03; /* Set baud rate */
	#FTDI_SIO_SET_DATA				= 0x04; /* Set the data characteristics of the port */
	#FTDI_SIO_GET_MODEM_STATUS		= 0x05; /* Retrieve current value of modem status register */
	#FTDI_SIO_SET_EVENT_CHAR		= 0x06; /* Set the event character */
	#FTDI_SIO_SET_ERROR_CHAR		= 0x07; /* Set the error character */
	#FTDI_SIO_SET_LATENCY_TIMER		= 0x09; /* Set the latency timer */
	#FTDI_SIO_GET_LATENCY_TIMER 	= 0x0a; /* Get the latency timer */
	#FTDI_SIO_SET_BITMODE			= 0x0b; /* Set bitbang mode */
	#FTDI_SIO_READ_PINS				= 0x0c; /* Read immediate value of pins */
	#FTDI_SIO_READ_EEPROM			= 0x90; /* Read EEPROM */

	/* not in linux driver? */
	#FTDI_BitMode_Reset       = 0x00;
	#FTDI_BitMode_BitBang     = 0x01;
	#FTDI_BitMode_MPSSE       = 0x02;
	#FTDI_BitMode_SyncBitBang = 0x04;
	#FTDI_BitMode_MCU         = 0x08;
	#FTDI_BitMode_Opto        = 0x10;
	#FTDI_BitMode_CBus        = 0x20;
	#FTDI_BitMode_SyncFIFO    = 0x40;

	/* Interface indices for FT2232, FT2232H and FT4232H devices */
	#INTERFACE_A		= 1;
	#INTERFACE_B		= 2;
	#INTERFACE_C		= 3;
	#INTERFACE_D		= 4;

	/* Port Identifier Table */
	#PIT_DEFAULT		= 0; /* SIOA */
	#PIT_SIOA			= 1; /* SIOA */

	/* The device this driver is tested with one has only one port */
	#PIT_SIOB			= 2; /* SIOB */
	#PIT_PARALLEL		= 3; /* Parallel */

	/* FTDI_SIO_RESET 
	 BmRequestType:  0100 0000B
	 bRequest:       FTDI_SIO_RESET
	 wValue:         Control Value
	                   0 = Reset SIO
	                   1 = Purge RX buffer
	                   2 = Purge TX buffer
	 wIndex:         Port
	 wLength:        0
	 Data:           None
	
	 The Reset SIO command has this effect:
	
	    Sets flow control set to 'none'
	    Event char = $0D
	    Event trigger = disabled
	    Purge RX buffer
	    Purge TX buffer
	    Clear DTR
	    Clear RTS
	    baud and data format not reset
	
	 The Purge RX and TX buffer commands affect nothing except the buffers
	
	*/
	#FTDI_SIO_RESET_REQUEST 	= this.#FTDI_SIO_RESET;
	#FTDI_SIO_RESET_REQUEST_TYPE = 'vendor';
	#FTDI_SIO_RESET_SIO 		= 0;
	#FTDI_SIO_RESET_PURGE_RX 	= 1;
	#FTDI_SIO_RESET_PURGE_TX 	= 2;

	/* FTDI_SIO_SET_BAUDRATE */
	#FTDI_SIO_SET_BAUDRATE_REQUEST 		= 0x03;


	#ftdi_chip_type = {
		SIO : 1,
		FT8U232AM : 2,
		FT232BM : 3,
		FT2232C : 4,
		FT232RL : 5,
		FT2232H : 6,
		FT4232H : 7,
		FT232H  : 8,
		FTX     : 9
	};

	/*
	  BmRequestType:  0100 0000B
	  bRequest:       FTDI_SIO_SET_BAUDRATE
	  wValue:         BaudDivisor value - see below
	  wIndex:         Port
	  wLength:        0
	  Data:           None
	  The BaudDivisor values are calculated as follows:
	  - BaseClock is either 12000000 or 48000000 depending on the device.
	    FIXME: I wish I knew how to detect old chips to select proper base clock!
	  - BaudDivisor is a fixed point number encoded in a funny way.
	    (--WRONG WAY OF THINKING--)
	    BaudDivisor is a fixed point number encoded with following bit weighs:
	    (-2)(-1)(13..0). It is a radical with a denominator of 4, so values
	    end with 0.0 (00...), 0.25 (10...), 0.5 (01...), and 0.75 (11...).
	    (--THE REALITY--)
	    The both-bits-set has quite different meaning from 0.75 - the chip
	    designers have decided it to mean 0.125 instead of 0.75.
	    This info looked up in FTDI application note "FT8U232 DEVICES \ Data Rates
	    and Flow Control Consideration for USB to RS232".
	  - BaudDivisor = (BaseClock / 16) / BaudRate, where the (=) operation should
	    automagically re-encode the resulting value to take fractions into
	    consideration.
	  As all values are integers, some bit twiddling is in order:
	    BaudDivisor = (BaseClock / 16 / BaudRate) |
	    (((BaseClock / 2 / BaudRate) & 4) ? 0x4000    // 0.5
	     : ((BaseClock / 2 / BaudRate) & 2) ? 0x8000  // 0.25
	     : ((BaseClock / 2 / BaudRate) & 1) ? 0xc000  // 0.125
	     : 0)
	 
	  For the FT232BM, a 17th divisor bit was introduced to encode the multiples
	  of 0.125 missing from the FT8U232AM.  Bits 16 to 14 are coded as follows
	  (the first four codes are the same as for the FT8U232AM, where bit 16 is
	  always 0):
	    000 - add .000 to divisor
	    001 - add .500 to divisor
	    010 - add .250 to divisor
	    011 - add .125 to divisor
	    100 - add .375 to divisor
	    101 - add .625 to divisor
	    110 - add .750 to divisor
	    111 - add .875 to divisor
	  Bits 15 to 0 of the 17-bit divisor are placed in the urb value.  Bit 16 is
	  placed in bit 0 of the urb index.
	 
	  Note that there are a couple of special cases to support the highest baud
	  rates.  If the calculated divisor value is 1, this needs to be replaced with
	  0.  Additionally for the FT232BM, if the calculated divisor value is 0x4001
	  (1.5), this needs to be replaced with 0x0001 (1) (but this divisor value is
	  not supported by the FT8U232AM).
	 */
	#ftdi_sio_baudrate = {
		ftdi_sio_b300 : 0,
		ftdi_sio_b600 : 1,
		ftdi_sio_b1200 : 2,
		ftdi_sio_b2400 : 3,
		ftdi_sio_b4800 : 4,
		ftdi_sio_b9600 : 5,
		ftdi_sio_b19200 : 6,
		ftdi_sio_b38400 : 7,
		ftdi_sio_b57600 : 8,
		ftdi_sio_b115200 : 9
	};

	/* FTDI_SIO_SET_DATA 
	  BmRequestType:  0100 0000B
	  bRequest:       FTDI_SIO_SET_DATA
	  wValue:         Data characteristics (see below)
	  wIndex:         Port
	  wLength:        0
	  Data:           No
	 
	  Data characteristics
	 
	    B0..7   Number of data bits
	    B8..10  Parity
	            0 = None
	            1 = Odd
	            2 = Even
	            3 = Mark
	            4 = Space
	    B11..13 Stop Bits
	            0 = 1
	            1 = 1.5
	            2 = 2
	    B14
	            1 = TX ON (break)
	            0 = TX OFF (normal state)
	    B15 Reserved
	 
	 */
	#FTDI_SIO_SET_DATA_REQUEST	= this.#FTDI_SIO_SET_DATA;
	#FTDI_SIO_SET_DATA_PARITY_NONE	= (0x0 << 8);
	#FTDI_SIO_SET_DATA_PARITY_ODD	= (0x1 << 8);
	#FTDI_SIO_SET_DATA_PARITY_EVEN	= (0x2 << 8);
	#FTDI_SIO_SET_DATA_PARITY_MARK	= (0x3 << 8);
	#FTDI_SIO_SET_DATA_PARITY_SPACE	= (0x4 << 8);
	#FTDI_SIO_SET_DATA_STOP_BITS_1	= (0x0 << 11);
	#FTDI_SIO_SET_DATA_STOP_BITS_15	= (0x1 << 11);
	#FTDI_SIO_SET_DATA_STOP_BITS_2	= (0x2 << 11);
	#FTDI_SIO_SET_BREAK				= (0x1 << 14);

	/* FTDI_SIO_MODEM_CTRL 

	  BmRequestType:   0100 0000B
	  bRequest:        FTDI_SIO_MODEM_CTRL
	  wValue:          ControlValue (see below)
	  wIndex:          Port
	  wLength:         0
	  Data:            None
	 
	  NOTE: If the device is in RTS/CTS flow control, the RTS set by this
	  command will be IGNORED without an error being returned
	  Also - you can not set DTR and RTS with one control message
	 */	
	#FTDI_SIO_SET_MODEM_CTRL_REQUEST 		= this.#FTDI_SIO_MODEM_CTRL;

	/*
	 ControlValue
	 B0    DTR state
	          0 = reset
	          1 = set
	 B1    RTS state
	          0 = reset
	          1 = set
	 B2..7 Reserved
	 B8    DTR state enable
	          0 = ignore
	          1 = use DTR state
	 B9    RTS state enable
	          0 = ignore
	          1 = use RTS state
	 B10..15 Reserved
	*/

	#FTDI_SIO_SET_DTR_MASK = 0x1;
	#FTDI_SIO_SET_DTR_HIGH = ((this.#FTDI_SIO_SET_DTR_MASK  << 8) | 1);
	#FTDI_SIO_SET_DTR_LOW  = ((this.#FTDI_SIO_SET_DTR_MASK  << 8) | 0);
	#FTDI_SIO_SET_RTS_MASK = 0x2;
	#FTDI_SIO_SET_RTS_HIGH = ((this.#FTDI_SIO_SET_RTS_MASK << 8) | 2);
	#FTDI_SIO_SET_RTS_LOW  = ((this.#FTDI_SIO_SET_RTS_MASK << 8) | 0);

	/* FTDI_SIO_SET_FLOW_CTRL 
	   BmRequestType:  0100 0000b
	   bRequest:       FTDI_SIO_SET_FLOW_CTRL
	   wValue:         Xoff/Xon
	   wIndex:         Protocol/Port - hIndex is protocol / lIndex is port
	   wLength:        0
	   Data:           None
	
	 hIndex protocol is:
	   B0 Output handshaking using RTS/CTS
	       0 = disabled
	       1 = enabled
	   B1 Output handshaking using DTR/DSR
	       0 = disabled
	       1 = enabled
	   B2 Xon/Xoff handshaking
	       0 = disabled
	       1 = enabled
	
	 A value of zero in the hIndex field disables handshaking
	
	 If Xon/Xoff handshaking is specified, the hValue field should contain the
	 XOFF character and the lValue field contains the XON character.
	 */
	#FTDI_SIO_SET_FLOW_CTRL_REQUEST = this.#FTDI_SIO_SET_FLOW_CTRL;
	#FTDI_SIO_DISABLE_FLOW_CTRL = 0x0;
	#FTDI_SIO_RTS_CTS_HS = (0x1 << 8);
	#FTDI_SIO_DTR_DSR_HS = (0x2 << 8);
	#FTDI_SIO_XON_XOFF_HS = (0x4 << 8);

	/*
	 FTDI_SIO_GET_LATENCY_TIMER
	
	 Set the timeout interval. The FTDI collects data from the
	 device, transmitting it to the host when either A) 62 bytes are
	 received, or B) the timeout interval has elapsed and the buffer
	 contains at least 1 byte.  Setting this value to a small number
	 can dramatically improve performance for applications which send
	 small packets, since the default value is 16ms.

	  BmRequestType:   1100 0000b
	  bRequest:        FTDI_SIO_GET_LATENCY_TIMER
	  wValue:          0
	  wIndex:          Port
	  wLength:         0
	  Data:            latency (on return)
	 */
	#FTDI_SIO_GET_LATENCY_TIMER_REQUEST = this.#FTDI_SIO_GET_LATENCY_TIMER;

	/*
	 FTDI_SIO_SET_LATENCY_TIMER

	 Set the timeout interval. The FTDI collects data from the
	 device, transmitting it to the host when either A) 62 bytes are
	 received, or B) the timeout interval has elapsed and the buffer
	 contains at least 1 byte.  Setting this value to a small number
	 can dramatically improve performance for applications which send
	 small packets, since the default value is 16ms.

	  BmRequestType:   0100 0000b
	  bRequest:        FTDI_SIO_SET_LATENCY_TIMER
	  wValue:          Latency (milliseconds)
	  wIndex:          Port
	  wLength:         0
	  Data:            None

	 wValue:
	   B0..7   Latency timer
	   B8..15  0

	*/
	#FTDI_SIO_SET_LATENCY_TIMER_REQUEST = this.#FTDI_SIO_SET_LATENCY_TIMER;


	/*
	 FTDI_SIO_SET_EVENT_CHAR
	
	 Set the special event character for the specified communications port.
	 If the device sees this character it will immediately return the
	 data read so far - rather than wait 40ms or until 62 bytes are read
	 which is what normally happens.

	  BmRequestType:   0100 0000b
	  bRequest:        FTDI_SIO_SET_EVENT_CHAR
	  wValue:          EventChar
	  wIndex:          Port
	  wLength:         0
	  Data:            None
	
	 wValue:
	   B0..7   Event Character
	   B8      Event Character Processing
	             0 = disabled
	             1 = enabled
	   B9..15  Reserved
	
	 FTDI_SIO_SET_ERROR_CHAR 
	 Set the parity error replacement character for the specified communications
	 port
	  BmRequestType:  0100 0000b
	  bRequest:       FTDI_SIO_SET_EVENT_CHAR
	  wValue:         Error Char
	  wIndex:         Port
	  wLength:        0
	  Data:           None
	
	Error Char
	  B0..7  Error Character
	  B8     Error Character Processing
	           0 = disabled
	           1 = enabled
	  B9..15 Reserved
	
	 */

	#FTDI_SIO_SET_EVENT_CHAR_REQUEST = this.#FTDI_SIO_SET_EVENT_CHAR;


	/* FTDI_SIO_GET_MODEM_STATUS 
	 Retrieve the current value of the modem status register 
	   BmRequestType:   1100 0000b
	   bRequest:        FTDI_SIO_GET_MODEM_STATUS
	   wValue:          zero
	   wIndex:          Port
	   wLength:         1
	   Data:            Status
	
	 One byte of data is returned
	 B0..3 0
	 B4    CTS
	         0 = inactive
	         1 = active
	 B5    DSR
	         0 = inactive
	         1 = active
	 B6    Ring Indicator (RI)
	         0 = inactive
	         1 = active
	 B7    Receive Line Signal Detect (RLSD)
	         0 = inactive
	         1 = active
	 */

	#FTDI_SIO_GET_MODEM_STATUS_REQUEST = this.#FTDI_SIO_GET_MODEM_STATUS;
	#FTDI_SIO_CTS_MASK 	= 0x10;
	#FTDI_SIO_DSR_MASK 	= 0x20;
	#FTDI_SIO_RI_MASK  	= 0x40;
	#FTDI_SIO_RLSD_MASK = 0x80;

	/* FTDI_SIO_SET_BITMODE */
	#FTDI_SIO_SET_BITMODE_REQUEST = this.#FTDI_SIO_SET_BITMODE;

	/* Possible bitmodes for FTDI_SIO_SET_BITMODE_REQUEST */
	#FTDI_SIO_BITMODE_RESET		= 0x00;
	#FTDI_SIO_BITMODE_CBUS		= 0x20;

	/* FTDI_SIO_READ_PINS */
	#FTDI_SIO_READ_PINS_REQUEST = this.#FTDI_SIO_READ_PINS;

	/*
	 * FTDI_SIO_READ_EEPROM
	 *
	 * EEPROM format found in FTDI AN_201, "FT-X MTP memory Configuration",
	 * http://www.ftdichip.com/Support/Documents/AppNotes/AN_201_FT-X%20MTP%20Memory%20Configuration.pdf
	 */
	#FTDI_SIO_READ_EEPROM_REQUEST = this.#FTDI_SIO_READ_EEPROM;

	#FTDI_FTX_CBUS_MUX_GPIO	 = 0x8;
	#FTDI_FT232R_CBUS_MUX_GPIO = 0xa;

	/* Descriptors returned by the device
	
	  Device Descriptor
	
	 Offset	Field			Size	Value	Description
	 0		bLength			1		0x12	Size of descriptor in bytes
	 1		bDescriptorType	1		0x01	DEVICE Descriptor Type
	 2		bcdUSB			2		0x0110	USB Spec Release Number
	 4		bDeviceClass	1		0x00	Class Code
	 5		bDeviceSubClass	1		0x00	SubClass Code
	 6		bDeviceProtocol	1		0x00	Protocol Code
	 7		bMaxPacketSize0 1		0x08	Maximum packet size for endpoint 0
	 8		idVendor		2		0x0403	Vendor ID
	 10		idProduct		2		0x8372	Product ID (FTDI_SIO_PID)
	 12		bcdDevice		2		0x0001	Device release number
	 14		iManufacturer	1		0x01	Index of man. string desc
	 15		iProduct		1		0x02	Index of prod string desc
	 16		iSerialNumber	1		0x02	Index of serial nmr string desc
	 17		bNumConfigurations 1    0x01	Number of possible configurations
	
	 Configuration Descriptor
	
	 Offset	Field			Size	Value
	 0	bLength			1	0x09	Size of descriptor in bytes
	 1	bDescriptorType		1	0x02	CONFIGURATION Descriptor Type
	 2	wTotalLength		2	0x0020	Total length of data
	 4	bNumInterfaces		1	0x01	Number of interfaces supported
	 5	bConfigurationValue	1	0x01	Argument for SetCOnfiguration() req
	 6	iConfiguration		1	0x02	Index of config string descriptor
	 7	bmAttributes		1	0x20	Config characteristics Remote Wakeup
	 8	MaxPower		1	0x1E	Max power consumption
	
	 Interface Descriptor
	
	 Offset	Field			Size	Value
	 0	bLength			1	0x09	Size of descriptor in bytes
	 1	bDescriptorType		1	0x04	INTERFACE Descriptor Type
	 2	bInterfaceNumber	1	0x00	Number of interface
	 3	bAlternateSetting	1	0x00	Value used to select alternate
	 4	bNumEndpoints		1	0x02	Number of endpoints
	 5	bInterfaceClass		1	0xFF	Class Code
	 6	bInterfaceSubClass	1	0xFF	Subclass Code
	 7	bInterfaceProtocol	1	0xFF	Protocol Code
	 8	iInterface		1	0x02	Index of interface string description
	
	 IN Endpoint Descriptor
	
	 Offset	Field			Size	Value
	 0	bLength			1	0x07	Size of descriptor in bytes
	 1	bDescriptorType		1	0x05	ENDPOINT descriptor type
	 2	bEndpointAddress	1	0x82	Address of endpoint
	 3	bmAttributes		1	0x02	Endpoint attributes - Bulk
	 4	bNumEndpoints		2	0x0040	maximum packet size
	 5	bInterval		1	0x00	Interval for polling endpoint
	
	 OUT Endpoint Descriptor
	
	 Offset	Field			Size	Value
	 0	bLength			1	0x07	Size of descriptor in bytes
	 1	bDescriptorType		1	0x05	ENDPOINT descriptor type
	 2	bEndpointAddress	1	0x02	Address of endpoint
	 3	bmAttributes		1	0x02	Endpoint attributes - Bulk
	 4	bNumEndpoints		2	0x0040	maximum packet size
	 5	bInterval		1	0x00	Interval for polling endpoint
	
	 DATA FORMAT
	
	 IN Endpoint
	
	 The device reserves the first two bytes of data on this endpoint to contain
	 the current values of the modem and line status registers. In the absence of
	 data, the device generates a message consisting of these two status bytes
	 every 40 ms *** (maybe 16ms for newer/higher clkd dev?)

	 *** According to TN103:

   	FTDI devices will return data to the host in 2 cases:
   	 •The IC has a full buffer of data to send back to the host. (64 bytes minus 2 status bytes)
   	 •The latency timer has expired. (default 16ms on windows driver; don't konw if this is device default)
   	 	- 16ms latency timer fucks with ISR (maybe others?) datalogging normally with HTS

	The latency timer acts as a timeout on the receive buffer which will trigger the transmission
	of any data in the chip’s receive buffer back to the host. 

	The latency timer acts as a timeout on the receive buffer which will trigger the transmission
	of any data in the chip’s receive buffer back to the host.  In cases when the amount of data
	being received is minimal, this prevents applications from having to wait a long time for a
	full packet.

	If the receive buffer of the chip is empty when the latency timer expires, 2 status
	bytes are returned which contain the modem status and line status of the UART.  For FT245
	devices, these bytes are still returned but have no meaning. If the latency timer is expiring
	before the receive buffer is full, short USB packets will be returned to the host.  As this is
	not the most efficient packet size, this may be unsuitable for some applications. 

	For example, a UART receiving data at 9600 baud with a default latency timer value (16ms) will
	generate USB packets of around 16 bytes before the latency timer expires and transmits the
	data available back to the PC.  If 64 byte IN packets were desired to minimise the number of
	INs required to complete a read,the packet size could be increased by increasing the value of
	the latency timer.  In this case, a value greater than 64ms would be sufficient for the chip to
	transmit full USB packets back to the host assuming data was constantly being received by the
	UART.

	In the case of FTDI’s USB-UART devices, the IN packet size may appear to be dependent
	on baud rate.  This is not the case: it is simply that the UART may receive data faster at a
	higher baud rate and thus has a better chance of filling the buffer before the latency
	timer expires

	When optimising data throughput for FTDI devices, the following factors should be considered:
		•Send as much data to the IC from the host application as possible in a single write.
		This will maximise the size of the data packets being sent to the device and hence minimise
		the number of packets required and time to transfer an amount of data.

		•Set the latency timer to a value appropriate for the application.  Note that a low latency
		timer value may result in many short incoming USB packets rather than a single large packet,
		thus diminishing performance

	 Byte 0: Modem Status
	
	 Offset	Description
	 B0	Reserved - must be 1
	 B1	Reserved - must be 0
	 B2	Reserved - must be 0
	 B3	Reserved - must be 0
	 B4	Clear to Send (CTS)
	 B5	Data Set Ready (DSR)
	 B6	Ring Indicator (RI)
	 B7	Receive Line Signal Detect (RLSD)
	
	 Byte 1: Line Status
	
	 Offset	Description
	 B0	Data Ready (DR)
	 B1	Overrun Error (OE)
	 B2	Parity Error (PE)
	 B3	Framing Error (FE)
	 B4	Break Interrupt (BI)
	 B5	Transmitter Holding Register (THRE)
	 B6	Transmitter Empty (TEMT)
	 B7	Error in RCVR FIFO
	
	 */
	#FTDI_RS0_CTS	=	(1 << 4);
	#FTDI_RS0_DSR	=	(1 << 5);
	#FTDI_RS0_RI	=	(1 << 6);
	#FTDI_RS0_RLSD	=	(1 << 7);

	#FTDI_RS_DR 	=	1;
	#FTDI_RS_OE 	=	(1 << 1);
	#FTDI_RS_PE 	=	(1 << 2);
	#FTDI_RS_FE 	=	(1 << 3);
	#FTDI_RS_BI 	=	(1 << 4);
	#FTDI_RS_THRE	=	(1 << 5);
	#FTDI_RS_TEMT	=	(1 << 6);
	#FTDI_RS_FIFO	=	(1 << 7);

	/*
	 * OUT Endpoint
	 *
	 * This device reserves the first bytes of data on this endpoint contain the
	 * length and port identifier of the message. For the FTDI USB Serial converter
	 * the port identifier is always 1.
	 *
	 * Byte 0: Line Status
	 *
	 * Offset	Description
	 * B0	Reserved - must be 1
	 * B1	Reserved - must be 0
	 * B2..7	Length of message - (not including Byte 0)
	 *
	 */

	constructor(device, portConfiguration) {
		this.device = device;
		this.portConfiguration = portConfiguration;

		this.interfaceNumber = 0;
		this.endpointIn = 0;
		this.endpointOut = 0;

		this.modemStatusByte = 0;
		this.lineStatusByte = 0;

		this.packetsReceived = 0;
	}

	connect(receiveCallback, errorCallback) {
		this.onReceive = receiveCallback;
		this.onReceiveError = errorCallback;

		let readLoop = () => {
		  this.device.transferIn(this.endpointIn, 64).then(result => {
		  	//console.log("Modem Status Byte:"+this.result.data[0])
		  	//console.log("Line Status Byte:"+this.result.data[1])
		  	let resultArray = new Uint8Array(result.data.buffer);

		  	if (resultArray[0] != this.modemStatusByte)
		  		this.modemStatusByte = resultArray[0];

		  	if (resultArray[1] != this.lineStatusByte)
		  		this.lineStatusByte = resultArray[1];

		  	if (resultArray.length > 2) {
		  		let dataArray = new Uint8Array(resultArray.length - 2);
		  		for (let x=2;x<resultArray.length;x++) {
		  			dataArray[x - 2] = resultArray[x];
		  		}
		    	this.onReceive(dataArray);
		  	} else {
		  		this.packetsReceived = this.packetsReceived + 1;
		  	}
		    
		    readLoop();

		  }, error => {
		    this.onReceiveError(error);
		  });
		};

		return this.device.open()
		    .then(() => {

		      if (this.device.configuration === null) {
		        return this.device.selectConfiguration(1);
		      }
		    })
		    .then(() => {
		      var interfaces = this.device.configuration.interfaces;
		      /*console.log("interfaces:")
		      console.log(interfaces)*/
		      interfaces.forEach(element => {
		        element.alternates.forEach(elementalt => {
		        	console.log(elementalt);
		          if (elementalt.interfaceClass==0xFF) {
		            this.interfaceNumber = element.interfaceNumber;
		            elementalt.endpoints.forEach(elementendpoint => {
		              if (elementendpoint.direction == "out") {
		                this.endpointOut = elementendpoint.endpointNumber;
		              }
		              if (elementendpoint.direction=="in") {
		                this.endpointIn = elementendpoint.endpointNumber;
		              }
		            })
		          }
		        })
		      })
		      /*console.log("in out");
		      console.log(this.endpointIn)
		      console.log(this.endpointOut)*/
		    })
		    .then(() => this.device.claimInterface(this.interfaceNumber))
		    .then(() => this.device.selectAlternateInterface(this.interfaceNumber, 0))
		    .then(() => {

		    	let baud = this.portConfiguration.baudrate;

/*		    	console.log("controlTransfer out now for " + this.interfaceNumber)
		    	console.log("req: " + this.#FTDI_SIO_SET_BAUD_RATE)
		    	console.log("val: " + this.getBaudDivisor(baud) + '(' + baud + ')')
		    	console.log("ind: " + this.getBaudBase())*/

				this.device.controlTransferOut({
				    requestType: 'vendor',
				    recipient: "device",
				    request: this.#FTDI_SIO_SET_BAUD_RATE,
				    value: this.getBaudDivisor(baud), // divisor_value
				    index: this.getBaudBase() // divisor_index
				});
			})
			.then(() => {

				return this.device.controlTransferIn({
					requestType: 'vendor',
					recipient: 'device',
					request: this.#FTDI_SIO_GET_LATENCY_TIMER_REQUEST,
					value: 0,
					index: 0
				},1);

			})
			.then((res) => {
				this.device.latencyTimer = new Uint8Array(res.data.buffer)[0];
				
				/*console.log("Current Latency Timer: ");
					console.log(this.device.latencyTimer);*/

				if (this.device.latencyTimer != 1) {
					/*console.log("Setting latency timer to 1")*/
					return this.device.controlTransferOut({
						requestType: 'vendor',
						recipient: "device",
						request: this.#FTDI_SIO_SET_LATENCY_TIMER_REQUEST,
						value: 1,
						index: 0
					});
				}
			})
			.then((res) => {
				return this.device.latencyTimer =   this.device.controlTransferIn({
					requestType: 'vendor',
					recipient: 'device',
					request: this.#FTDI_SIO_GET_LATENCY_TIMER_REQUEST,
					value: 0,
					index: 0
				},1);

    		    /*	console.log(this.device.controlTransferOut({
		        'requestType': 'class',
		        'recipient': 'interface',
		        'request': 0x22,
		        'value': 0x01,
		        'index': this.interfaceNumber
		    	}))*/
		    })
		    .then((res) => {
				this.device.latencyTimer = new Uint8Array(res.data.buffer)[0];
				
				console.log("Current Latency Timer: ");
					console.log(this.device.latencyTimer);
	      		readLoop();
				return this.device;
		    });
	}

 	DIV_ROUND_CLOSEST(x, divisor)
	{							
		let __x = x;				
		let __d = divisor;			
		return ((((x))-1) > 0 ||				
		 (((divisor))-1) > 0 ||			
		 (((__x) > 0) == ((__d) > 0))) ?		
			(((__x) + ((__d) / 2)) / (__d)) :	
			(((__x) - ((__d) / 2)) / (__d));	
	}							
	
	getBaudBase() {
		// older devices = 12000000 ? 
		return 48000000;
	}

	getBaudDivisor(baud) {
/*
	works for 232bm, 2232c, 232rl, ftx
*/

		let base = this.getBaudBase();
	
	//	static const unsigned char divfrac[8] = { 0, 3, 2, 4, 1, 5, 6, 7 };

		let divfrac = new Uint8Array(8);
		divfrac = [ 0, 3, 2, 4, 1, 5, 6, 7 ];

		let divisor = 0;

		let divisor3 = this.DIV_ROUND_CLOSEST(base, 2 * baud);
		divisor = divisor3 >> 3;
		divisor |= divfrac[divisor3 & 0x7] << 14;
		/* Deal with special cases for highest baud rates. */
		if (divisor == 1)
			divisor = 0;
		else if (divisor == 0x4001)
			divisor = 1;
		return divisor;

	}

	/* The SIO requires the first byte to have:
	 *  B0 1
	 *  B1 0
	 *  B2..7 length of message excluding byte 0
	 *
	 * The new devices do not require this byte
	 */

	send(data) {
		return this.device.transferOut(this.endpointOut, data);
	}

	disconnect() {
		/*return console.log(this.device.controlTransferOut({
		        'requestType': 'class',
		        'recipient': 'interface',
		        'request': 0x22,
		        'value': 0x01,
		        'index': this.interfaceNumber
		    	}).then(()=>
		 this.device.close()))*/
		 this.device.close();
	}
}

class WebUSBSerialDevice {
	constructor(configuration) {
		if (!('usb' in navigator)) {
			throw new Error('USB Support not available!');
		}

		this.configuration = configuration || {
			// Whether or not to override/specify baud/bits/stop/parity
			overridePortSettings: false,
			
			// Default settings, only used when overridden
			baudrate: 9600,
			bits: 8,
			stop: 1,
			parity: false,

			// Some default FTDI device IDs
			// you can replace these with any device that has
			// an ftdi chip.
			deviceFilters: [
				/*{ 'vendorId' : 0x0403, 'productId' : 0x6000 },
				{ 'vendorId' : 0x0403, 'productId' : 0x6001 },
				{ 'vendorId' : 0x0403, 'productId' : 0x6010 },
				{ 'vendorId' : 0x0403, 'productId' : 0x6011 },
				{ 'vendorId' : 0x0403, 'productId' : 0x6014 }*/
			]
		}

		this.devices = [];
		//this.ports = [];
	}

	async getAvailablePorts() {
	    this.devices = await navigator.usb.getDevices();

    	return this.devices.map(device => new WebUSBSerialPort(device));
	}

	async requestNewPort() {
		try {
			let device = await navigator.usb.requestDevice({
				filters : this.configuration.deviceFilters
			});

			if (!(device in this.devices))
				this.devices.push(device);

			return new WebUSBSerialPort(device, this.configuration);
		} catch (e) {
			throw new Error(e);
		}
	}

}



