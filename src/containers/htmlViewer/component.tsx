import React from "react";
import RecentBooks from "../../utils/readUtils/recordRecent";
import { ViewerProps, ViewerState } from "./interface";
import localforage from "localforage";
import { withRouter } from "react-router-dom";
import BookUtil from "../../utils/fileUtils/bookUtil";
import MobiParser from "../../utils/fileUtils/mobiParser";
import iconv from "iconv-lite";
import chardet from "chardet";
import rtfToHTML from "@iarna/rtf-to-html";
import {
  xmlBookTagFilter,
  xmlBookToObj,
  txtToHtml,
} from "../../utils/fileUtils/xmlUtil";
import HtmlParser from "../../utils/fileUtils/htmlParser";
import OtherUtil from "../../utils/otherUtil";
import RecordLocation from "../../utils/readUtils/recordLocation";
import { mimetype } from "../../constants/mimetype";
import styleUtil from "../../utils/readUtils/styleUtil";
import { isElectron } from "react-device-detect";
import _ from "underscore";
import BackgroundWidget from "../../components/backgroundWidget";
import toast from "react-hot-toast";

declare var window: any;

class Viewer extends React.Component<ViewerProps, ViewerState> {
  epub: any;
  lock: boolean;
  constructor(props: ViewerProps) {
    super(props);
    this.state = {
      key: "",

      isFirst: true,
      scale: OtherUtil.getReaderConfig("scale") || 1,
      chapterTitle:
        RecordLocation.getScrollHeight(this.props.currentBook.key)
          .chapterTitle || "",
    };
    this.lock = false;
  }

  componentDidMount() {
    let { key, path, format, name } = this.props.currentBook;
    BookUtil.fetchBook(key, true, path).then((result) => {
      if (!result) {
        toast.error(this.props.t("Book not exsits"));
        return;
      }

      if (format === "MOBI" || format === "AZW3") {
        this.handleMobi(result as ArrayBuffer);
      } else if (format === "TXT") {
        this.handleTxt(result as ArrayBuffer);
      } else if (format === "MD") {
        this.handleMD(result as ArrayBuffer);
      } else if (format === "FB2") {
        this.handleFb2(result as ArrayBuffer);
      } else if (format === "RTF") {
        this.handleRtf(result as ArrayBuffer);
      } else if (format === "DOCX") {
        this.handleDocx(result as ArrayBuffer);
      } else if (
        format === "HTML" ||
        format === "XHTML" ||
        format === "HTM" ||
        format === "XML"
      ) {
        this.handleHtml(result as ArrayBuffer, format);
      }
      this.props.handleReadingState(true);

      RecentBooks.setRecent(this.props.currentBook.key);
      document.title = name + " - Koodo Reader";
    });

    this.props.handleRenderFunc(this.handleRenderHtml);

    window.frames[0].document.addEventListener("click", (event) => {
      this.props.handleLeaveReader("left");
      this.props.handleLeaveReader("right");
      this.props.handleLeaveReader("top");
      this.props.handleLeaveReader("bottom");
    });
  }
  handleIframeHeight = () => {
    let iFrame: any = document.getElementsByTagName("iframe")[0];
    var body = iFrame.contentWindow.document.body,
      html = iFrame.contentWindow.document.documentElement;
    iFrame.height =
      Math.max(
        body.scrollHeight,
        body.offsetHeight,
        html.clientHeight,
        html.scrollHeight,
        html.offsetHeight
      ) * 2;

    setTimeout(() => {
      let iFrame: any = document.getElementsByTagName("iframe")[0];
      let body = iFrame.contentWindow.document.body;
      let lastchild = body.lastElementChild;
      let lastEle = body.lastChild;
      let itemAs = body.querySelectorAll("a");
      let itemPs = body.querySelectorAll("p");
      let lastItemA = itemAs[itemAs.length - 1];
      let lastItemP = itemPs[itemPs.length - 1];

      let lastItem = lastItemP || lastItemA;
      if (_.isElement(lastItemA) && _.isElement(lastItemP)) {
        if (
          lastItemA.clientHeight + (lastItemA as any).offsetTop >
          lastItemP.clientHeight + (lastItemP as any).offsetTop
        ) {
          lastItem = lastItemA;
        } else {
          lastItem = lastItemP;
        }
      }
      let nodeHeight = 0;

      if (!lastchild && !lastItem && !lastEle) return;
      if (lastEle.nodeType === 3 && !lastchild && !lastItem) return;

      if (lastEle.nodeType === 3) {
        if (document.createRange) {
          let range = document.createRange();
          range.selectNodeContents(lastEle);
          if (range.getBoundingClientRect) {
            let rect = range.getBoundingClientRect();
            if (rect) {
              nodeHeight = rect.bottom - rect.top;
            }
          }
        }
      }

      iFrame.height =
        Math.max(
          _.isElement(lastchild)
            ? lastchild.clientHeight + (lastchild as any).offsetTop
            : 0,
          _.isElement(lastEle)
            ? lastEle.clientHeight + (lastEle as any).offsetTop
            : 0,
          _.isElement(lastItem)
            ? lastItem.clientHeight + (lastItem as any).offsetTop
            : 0
        ) +
        600 +
        (lastEle.nodeType === 3 ? nodeHeight : 0);
    }, 500);
  };
  handleRecord() {
    if (this.lock) return;

    RecordLocation.recordScrollHeight(
      this.props.currentBook.key,
      (Array.from(
        window.frames[0].document.getElementsByTagName("p")
      ).filter((s) => this.isScrolledIntoView(s as any))[0] as HTMLElement)
        ? (Array.from(
            window.frames[0].document.getElementsByTagName("p")
          ).filter((s) => this.isScrolledIntoView(s as any))[0] as HTMLElement)
            .innerText
        : "",
      this.state.chapterTitle
    );
    this.lock = true;
    setTimeout(() => {
      this.lock = false;
    }, 500);
  }
  handleRest = (docStr: string) => {
    let htmlParser = new HtmlParser(
      new DOMParser().parseFromString(docStr, "text/html"),
      this.props.currentBook.format,
      this.props.currentBook.content
        ? JSON.parse(this.props.currentBook.content)
        : []
    );
    this.props.handleHtmlBook({
      key: this.props.currentBook.key,
      doc: htmlParser.getAnchoredDoc(),
      chapters: htmlParser.getContentList(),
      subitems: [],
      chapterDoc:
        htmlParser.getChapter(
          htmlParser.getAnchoredDoc().body.innerHTML,
          htmlParser.getContentList()
        ) || [],
    });
    this.handleRenderHtml();
  };
  isScrolledIntoView = (el: HTMLElement) => {
    var rect = el.getBoundingClientRect();
    var elemTop = rect.top;
    var viewer = document.getElementsByClassName("ebook-viewer")[0];
    var screen = document.getElementsByClassName("viewer")[0];
    var isVisible =
      elemTop >= viewer.scrollTop &&
      elemTop <= viewer.scrollTop + (screen as HTMLElement).offsetHeight;

    return isVisible;
  };
  handleRenderHtml = (id: string = "") => {
    if (id === "html-render") {
      styleUtil.addHtmlCss();
      this.handleIframeHeight();

      return;
    }
    window.frames[0].document.body.innerHTML = "";

    id &&
      this.setState({
        chapterTitle: this.props.htmlBook.chapters[
          _.findIndex(this.props.htmlBook.chapters, {
            id: id,
          }) + 1
        ].label,
      });
    console.log(
      this.props.htmlBook.chapterDoc,
      this.props.htmlBook.chapters,
      this.state.chapterTitle
    );
    window.frames[0].document.body.innerHTML = this.props.htmlBook.chapterDoc[
      id
        ? _.findIndex(this.props.htmlBook.chapters, {
            id,
          }) + 1
        : _.findIndex(this.props.htmlBook.chapters, {
            label: this.state.chapterTitle,
          }) + 1
    ];
    this.props.handleCurrentChapter(id);
    styleUtil.addHtmlCss();
    this.handleIframeHeight();

    setTimeout(() => {
      console.log(this.state.isFirst, id);
      if (this.state.isFirst || id === "html-render") {
        document
          .getElementsByClassName("ebook-viewer")[0]
          .scrollTo(
            0,
            RecordLocation.getScrollHeight(this.props.currentBook.key).text &&
              (Array.from(
                window.frames[0].document.getElementsByTagName("p")
              ).filter(
                (s) =>
                  (s as HTMLElement).innerText ===
                  RecordLocation.getScrollHeight(this.props.currentBook.key)
                    .text
              )[0] as HTMLElement)
              ? (Array.from(
                  window.frames[0].document.getElementsByTagName("p")
                ).filter(
                  (s) =>
                    (s as HTMLElement).innerText ===
                    RecordLocation.getScrollHeight(this.props.currentBook.key)
                      .text
                )[0] as HTMLElement).offsetTop
              : 0
          );
        this.setState({ isFirst: false });
      } else {
        document.getElementsByClassName("ebook-viewer")[0].scrollTo(0, 0);
      }

      let iframe = document.getElementsByTagName("iframe")[0];
      if (!iframe) return;
      let doc = iframe.contentDocument;
      if (!doc) {
        return;
      }

      let imgs = doc.getElementsByTagName("img");
      let links = doc.getElementsByTagName("a");
      for (let item of links) {
        item.addEventListener("click", (e) => {
          e.preventDefault();
          this.handleJump(item.href);
        });
      }
      for (let item of imgs) {
        item.setAttribute("style", "max-width: 100%");
      }

      this.bindEvent(doc);
    }, 1);
  };
  handleJump = (url: string) => {
    isElectron
      ? window.require("electron").shell.openExternal(url)
      : window.open(url);
  };
  handleTurnChapter = () => {
    var element = document.getElementsByClassName("ebook-viewer")[0];

    if (
      Math.abs(
        element.scrollHeight - element.scrollTop - element.clientHeight
      ) < 10
    ) {
      if (
        _.findIndex(this.props.htmlBook.chapters, {
          label: this.state.chapterTitle,
        }) ===
        this.props.htmlBook.chapters.length - 1
      ) {
        return;
      }
      this.setState(
        {
          chapterTitle: this.props.htmlBook.chapters[
            _.findIndex(this.props.htmlBook.chapters, {
              label: this.state.chapterTitle,
            }) + 1
          ].label,
        },
        () => {
          this.handleRenderHtml();
        }
      );
    }
  };
  bindEvent = (doc: any) => {
    let isFirefox = navigator.userAgent.indexOf("Firefox") > -1;
    // 鼠标滚轮翻页

    if (isFirefox) {
      doc.addEventListener(
        "DOMMouseScroll",
        () => {
          this.handleRecord();
          this.handleTurnChapter();
        },
        false
      );
    } else {
      doc.addEventListener(
        "mousewheel",
        (event) => {
          this.handleRecord();
          this.handleTurnChapter();
        },
        false
      );
    }
  };
  handleMobi = async (result: ArrayBuffer) => {
    let mobiFile = new MobiParser(result);

    let content: any = await mobiFile.render();

    this.handleRest(content.outerHTML);
  };
  handleChapter = (docStr: string) => {
    return new Promise<void>(async (resolve, reject) => {
      let { books } = this.props;
      let htmlParser = new HtmlParser(
        new DOMParser().parseFromString(docStr, "text/html"),
        this.props.currentBook.format,
        this.props.currentBook.content
          ? JSON.parse(this.props.currentBook.content)
          : []
      );
      books.forEach((item) => {
        if (item.key === this.props.currentBook.key) {
          item.content = JSON.stringify(htmlParser.getChapterTitleList());
          this.props.handleReadingBook(item);
        }
      });
      await localforage.setItem("books", books);
      // this.props.handleFetchBooks();
      resolve();
    });
  };
  handleCharset = (result: ArrayBuffer) => {
    return new Promise<string>(async (resolve, reject) => {
      let { books } = this.props;
      let charset = "";
      books.forEach((item) => {
        if (item.key === this.props.currentBook.key) {
          charset = chardet.detect(Buffer.from(result)) || "";
          item.charset = charset;
          this.props.handleReadingBook(item);
        }
      });

      await localforage.setItem("books", books);
      // this.props.handleFetchBooks();
      resolve(charset);
    });
  };
  handleTxt = async (result: ArrayBuffer) => {
    let charset = "";
    if (!this.props.currentBook.charset) {
      charset = await this.handleCharset(result);
    }
    let text = iconv
      .decode(
        Buffer.from(result),
        this.props.currentBook.charset || charset || "utf8"
      )
      .split("\n");
    console.log(
      text,
      iconv.decode(
        Buffer.from(result),
        this.props.currentBook.charset || charset || "utf8"
      )
    );
    let docStr = "";
    docStr = txtToHtml(
      text,
      this.props.currentBook.content
        ? JSON.parse(this.props.currentBook.content)
        : [],
      RecordLocation.getCfi(this.props.currentBook.key).chapterTitle
    );

    if (!this.props.currentBook.content) {
      await this.handleChapter(docStr);
    }
    this.handleRest(docStr);
  };
  handleMD = (result: ArrayBuffer) => {
    var blob = new Blob([result], { type: "text/plain" });
    var reader = new FileReader();
    reader.onload = async (evt) => {
      let docStr = window.marked(evt.target?.result as any);
      if (!this.props.currentBook.content) {
        await this.handleChapter(docStr);
      }
      this.handleRest(docStr);
    };
    reader.readAsText(blob, "UTF-8");
  };
  handleRtf = async (result: ArrayBuffer) => {
    let charset = "";
    if (!this.props.currentBook.charset) {
      charset = await this.handleCharset(result);
    }
    let text = iconv.decode(
      Buffer.from(result),
      this.props.currentBook.charset || charset || "utf8"
    );

    rtfToHTML.fromString(text, async (err: any, html: any) => {
      if (!this.props.currentBook.content) {
        await this.handleChapter(html);
      }
      this.handleRest(html);
    });
  };
  handleDocx = (result: ArrayBuffer) => {
    window.mammoth
      .convertToHtml({ arrayBuffer: result })
      .then(async (res: any) => {
        if (!this.props.currentBook.content) {
          await this.handleChapter(res.value);
        }
        this.handleRest(res.value);
      });
  };
  handleFb2 = async (result: ArrayBuffer) => {
    let charset = "";
    if (!this.props.currentBook.charset) {
      charset = await this.handleCharset(result);
    }
    let fb2Str = iconv.decode(
      Buffer.from(result),
      this.props.currentBook.charset || charset || "utf8"
    );
    let bookObj = xmlBookToObj(Buffer.from(result));
    bookObj += xmlBookTagFilter(fb2Str);
    if (!this.props.currentBook.content) {
      await this.handleChapter(bookObj);
    }
    this.handleRest(bookObj);
  };
  handleHtml = (result: ArrayBuffer, format: string) => {
    var blob = new Blob([result], {
      type: mimetype[format.toLocaleLowerCase()],
    });
    var reader = new FileReader();
    reader.onload = async (evt) => {
      const html = evt.target?.result as any;
      if (!this.props.currentBook.content) {
        await this.handleChapter(html);
      }
      this.handleRest(html);
    };
    reader.readAsText(blob, "UTF-8");
  };
  render() {
    return (
      <>
        <div
          className="ebook-viewer"
          style={{
            position: "absolute",
            left: `calc(50vw - ${270 * parseFloat(this.state.scale)}px + 9px)`,
            right: `calc(50vw - ${270 * parseFloat(this.state.scale)}px + 7px)`,
            top: "20px",
            bottom: "20px",
            overflowY: "scroll",
            zIndex: 5,
          }}
        >
          <iframe title="html-viewer" width="100%">
            Loading
          </iframe>
        </div>
        {OtherUtil.getReaderConfig("isHideBackground") === "yes" ? null : this
            .props.currentBook.key ? (
          <BackgroundWidget />
        ) : null}
      </>
    );
  }
}
export default withRouter(Viewer as any);
