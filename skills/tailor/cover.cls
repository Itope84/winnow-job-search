% Intro Options
\ProvidesClass{cover}[2024/04/30 Cover letter class]
\NeedsTeXFormat{LaTeX2e}
\DeclareOption{print}{\def\@cv@print{}}
\DeclareOption*{%
  \PassOptionsToClass{\CurrentOption}{article}
}
\ProcessOptions\relax
\LoadClass{article}

% Package Imports
\usepackage[hmargin=2.3cm, vmargin=1.8cm]{geometry}
\usepackage[hidelinks]{hyperref}
\usepackage[usenames,dvipsnames]{xcolor}
\usepackage{titlesec}
\usepackage[absolute]{textpos}
\usepackage{fontspec,xltxtra,xunicode}

% Publications
\usepackage{cite}
\renewcommand\refname{\vskip -1.5cm}

% Color definitions
\definecolor{date}{HTML}{666666}
\definecolor{primary}{HTML}{2b2b2b}
\definecolor{headings}{HTML}{6A6A6A}
\definecolor{accent}{HTML}{3873B3}
\definecolor{subheadings}{HTML}{333333}

% Set main fonts
% Montserrat headings and Open Sans body, as in the CV (winnow-cv.sty). Fonts in fonts/, SIL OFL 1.1.
\setmainfont{OpenSans}[Color=primary, Path = fonts/opensans/, Extension = .ttf,
  UprightFont = *-Regular, BoldFont = *-SemiBold, ItalicFont = *-Italic, BoldItalicFont = *-BoldItalic]
\setsansfont{OpenSans}[Path = fonts/opensans/, Extension = .ttf,
  UprightFont = *-Regular, BoldFont = *-SemiBold, ItalicFont = *-Italic, BoldItalicFont = *-BoldItalic]
% Line height half again the default, as on the CV.
\linespread{1.5}
\newfontfamily\bodyfont{OpenSans}[Path = fonts/opensans/, Extension = .ttf,
  UprightFont = *-Regular, BoldFont = *-SemiBold, ItalicFont = *-Italic, BoldItalicFont = *-BoldItalic]
\newfontfamily\headingfont{Montserrat}[Path = fonts/montserrat/, Extension = .ttf,
  UprightFont = *-SemiBold, BoldFont = *-Bold]

% Date command
\setlength{\TPHorizModule}{1mm}
\setlength{\TPVertModule}{1mm}
\newcommand{\lastupdated}{\begin{textblock}{60}(155,5)
\color{date}\bodyfont\fontsize{8pt}{10pt}\selectfont 
Last Updated on \today
\end{textblock}}

% Name command
\newcommand{\namesection}[3]{
\centering{
\color{accent}\fontsize{30pt}{40pt}
\headingfont\selectfont #1 #2
} \\[8pt]
\centering{
\color{headings}
\bodyfont\fontsize{11pt}{14pt}\selectfont #3}
\noindent\makebox[\linewidth]{\color{headings}\rule{\paperwidth}{0.0pt}}
\vspace{0pt}
}

% Section seperators
\titlespacing{\section}{0pt}{0pt}{0pt}
\titlespacing{\subsection}{0pt}{0pt}{0pt}
\newcommand{\sectionsep}{\vspace{8pt}}

% Headings command
\titleformat{\section}{\color{headings}
\scshape\headingfont\fontsize{16pt}{24pt}\selectfont \raggedright\uppercase}{}{0em}{}

% Subeadings command
\titleformat{\subsection}{
\color{subheadings}\headingfont\fontsize{12pt}{12pt}\selectfont\bfseries\uppercase}{}{0em}{}

\newcommand{\runsubsection}[1]{
\color{subheadings}\headingfont\fontsize{12pt}{12pt}\selectfont\bfseries\uppercase {#1} \normalfont}

% Descriptors command
\newcommand{\descript}[1]{
\color{subheadings}\raggedright\scshape\bodyfont\fontsize{11pt}{13pt}\selectfont {#1 \\} \normalfont}

% Location command
\newcommand{\location}[1]{
\color{headings}\raggedright\bodyfont\fontsize{10pt}{12pt}\selectfont {#1\\} \normalfont}

% Bullet Lists with fewer gaps command
\newenvironment{tightemize}{
\vspace{-\topsep}\begin{itemize}\itemsep1pt \parskip0pt \parsep0pt}
{\end{itemize}\vspace{-\topsep}}

% Cover Letter
\newcommand{\companyname}[1]{\raggedright\headingfont\fontsize{12pt}{14pt}\selectfont {#1 \\} \normalfont}

\newcommand{\companyaddress}[1]{\raggedright\bodyfont\fontsize{11pt}{13pt}\selectfont {#1 \\}\mbox{}\\\mbox{}\\ \normalfont}

\newcommand{\currentdate}[1]{\raggedleft\bodyfont\fontsize{11pt}{13pt}\selectfont {#1 \\} \normalfont}

% Letter content command
\newcommand{\lettercontent}[1]{\raggedright\bodyfont\fontsize{11pt}{13pt}\selectfont {#1 \\}\mbox{}\\ \normalfont}

\newcommand{\closing}[1]{\raggedright\bodyfont\fontsize{11pt}{13pt}\selectfont {#1 \\}\mbox{}\\\mbox{}\\ \normalfont}

\newcommand{\signature}[1]{\raggedright\bodyfont\fontsize{11pt}{13pt}\selectfont {#1 \\} \normalfont}