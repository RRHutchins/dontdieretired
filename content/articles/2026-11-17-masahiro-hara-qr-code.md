---
title: "Masahiro Hara and the three squares that let a QR code be read from any angle"
slug: masahiro-hara-qr-code
date: 2026-11-17
category: curious
tags: [qr-codes, inventions, engineering, japan, technology, history]
segments: [learner, changer]
level: any
art: grid
hook: "Two engineers, no budget and a pattern of 1:1:3:1:1 that almost never turns up in print."
lesson: "The cleverest part of an invention is often the dull problem it solves first: here, finding the code before reading it."
standfirst: "In 1992 a Denso engineer set out to replace the strings of barcodes on Japanese car-parts boxes. Two years later his team released the QR code. The squares in its corners, and the decision not to charge anyone for using it, are why it is on menus and tickets today."
summary: "How Masahiro Hara and a small team at Denso designed the QR code between 1992 and 1994, why its three corner squares use the ratio 1:1:3:1:1, how much damage it survives, what Denso did with its patents, and where the Go board story comes from."
description: "The invention of the QR code by Masahiro Hara at Denso in 1992–94: the corner squares, error correction, the patents and the Go board story, from Hara's own paper, IEEE Spectrum and the European Patent Office."
try_this:
  - "Look at any QR code near you, on a parcel label, a ticket or a poster, and find the three large squares in its corners. Count across one: a black band, a white band, a black block three times as wide, white, black. That is the 1:1:3:1:1 pattern."
  - "Cover part of a QR code you trust (one you made, or one on a product you bought) with your thumb and see whether your phone still reads it. Cover a little more each time until it fails. Only scan codes from a source you trust."
  - "Read Masahiro Hara's own account, 'Development and popularization of QR code', free online in the English edition of the journal Synthesiology (2019). It is ten pages and plainly written."
try_this_plus:
  - "Make two QR codes for the same web address with a free generator: one at error-correction level L (7%) and one at level H (30%). Print both, compare how dense they are, then cover a corner of each with tape and see which one your phone can still read."
  - "Search Espacenet or Google Patents (both free) for Denso patents on two-dimensional codes from the mid-1990s, then read section 3.3 of Hara's paper on why the company kept patents while letting anyone use the code. Write down in two sentences how both can be true."
  - "Put Hara's paper beside Joanna Goodrich's 2020 IEEE Spectrum article and list every point where they differ: the digit count, the speed comparisons, the Go board. For each, decide which source you would trust and why."
sources:
  - {title: "Development and popularization of QR code", publisher: "Masahiro Hara (Denso Wave), Synthesiology English edition, Vol. 12 No. 1, AIST", date: "August 2019", url: "https://www.aist.go.jp/pdf/aist_e/synthesiology_e/vol12_no1/vol12_01_p19_p28.pdf"}
  - {title: "How a Board Game and Skyscrapers Inspired the Development of the QR Code", publisher: "IEEE Spectrum (The Institute), by Joanna Goodrich", date: "13 November 2020", url: "https://spectrum.ieee.org/how-a-board-game-and-skyscrapers-inspired-the-development-of-the-qr-code"}
  - {title: "The QR code: Masahiro Hara, Motoaki Watabe, Tadao Nojiri, Takayuki Nagaya and Yuji Uchiyama", publisher: "European Patent Office, European Inventor Award 2014 finalists", date: "accessed 17 November 2026", url: "https://epo.org/learning-events/european-inventor/finalists/2014/hara.html"}
---
At car-parts plants in Japan in the early 1990s, a box could carry so many barcodes that a worker had to scan it again and again. Masahiro Hara, an engineer at the Japanese car-parts maker Denso, later wrote that about ten different barcodes had to be read at manufacturing plants to keep track of things.

In 1992 he set out to replace them with one code. In his own account, published in 2019 in Synthesiology, a journal of Japan's National Institute of Advanced Industrial Science and Technology, he says the work began with just two people and no development budget. In 1994 Denso released the result. It called it the QR code, for Quick Response.

## The problem was finding the code

A barcode holds very little. IEEE Spectrum notes that the common UPC barcode carries up to 12 numbers; the European Patent Office (EPO) puts the barcodes of the day at about 20 characters. Two-dimensional codes, which store information across and down, already existed and held far more. Their weakness was speed. A reader had to work out where the code was and which way up it sat before it could decode anything.

Hara's answer was the three squares in the corners. Each one is drawn so that a line through its centre, in any direction, crosses black, white, black, white and black bands in the ratio 1:1:3:1:1. He wrote that his team chose that ratio after surveying the black and white patterns in printed letters and figures, and found it almost never occurred. A scanner that meets that rhythm three times knows it has found a QR code, where its corners are and how it is turned.

IEEE Spectrum, drawing on an interview Hara gave the Japanese broadcaster NHK World-Japan, adds a picture of where the idea came from. Hara was on a train to work. "I was just looking out the window when I noticed a tall building standing out from its surroundings," he told NHK. The code, he realised, needed a mark that stood out in the same way. The same report says the ratio took about three months of testing.

## Fast, dense and hard to spoil

Hara's paper gives the specification. The largest QR code holds 7,089 numerals, 4,296 letters and numbers, or 1,817 Japanese kanji characters. In the IEEE article he is quoted giving the figure as 7,087 digits; the EPO says about 7,000. The difference is small, and the paper's table is the more formal source.

The sources also measure speed against different things. Hara's paper says a QR code reads in about 30 milliseconds, as fast as a barcode, but carries five times the information, and is about 50 times quicker to process than other matrix codes of the day. The EPO says 20 times faster than earlier matrix codes. IEEE quotes Hara saying it reads five times faster than a typical barcode.

The code also repairs itself. It uses Reed–Solomon error correction at four levels, which Hara's paper says recover the data when 7, 15, 25 or 30 per cent of the code is soiled or damaged. That is why a creased label or a scuffed sticker still scans.

## The Go board story

Many accounts say the QR code was inspired by Go, the board game played with black and white stones. IEEE Spectrum reports it, again from the NHK interview: on a Go board a stone placed slightly off the intersection is still read as being on it, and Hara applied that tolerance to his code.

It is worth knowing where the story stops. Hara's own ten-page paper on the code's development does not mention Go at all, and nor does the EPO's page. The Go board is Hara's story, as told to a broadcaster; the 1:1:3:1:1 survey is the part he wrote down in detail.

## Free to use, but patented

The usual telling is that Denso gave the QR code away. Hara's paper is more precise. The company declared the code free to use with no patent claims, and later standardised it: an international ISO standard came in 2000. But it kept its patents. IEEE Spectrum lists them: the United States in 1998, Japan in 1999 and Europe in 2000. Hara explains why: "Possession of patent rights proved that we would not be sued for any patent violation." The patents also let Denso stop poor copies; he writes that the company issued only one warning. The core image-recognition method was kept as a trade secret.

The openness worked. Hara writes that use spread explosively after 2010. He was a finalist for the European Inventor Award in 2014 with colleagues including Takayuki Nagaya of Toyota Central R&D Labs, and in 2020 IEEE made the QR code one of its engineering Milestones.

For more on everyday things with surprising origins, read how [Percy Shaw invented the cat's eye](/curious/percy-shaw-cats-eyes/), or how [David Warren came up with the black box flight recorder](/curious/david-warren-black-box-flight-recorder/).
