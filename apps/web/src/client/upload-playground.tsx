import { useState } from "react";
import { StarIcon } from "@phosphor-icons/react/Star";
import { PaperPlaneTiltIcon } from "@phosphor-icons/react/PaperPlaneTilt";
import { FilesIcon } from "@phosphor-icons/react/Files";
import { CheckCircleIcon } from "@phosphor-icons/react/CheckCircle";
export function UploadPlayground({
  progress,
  label,
  processed,
  total,
}: {
  progress?: number;
  label: string;
  processed?: number;
  total?: number;
}) {
  const [score, setScore] = useState(0);
  const [position, setPosition] = useState(4);
  const [playing, setPlaying] = useState(false);
  return (
    <section className="upload-playground" aria-label="文稿处理进度与小游戏">
      <div className="upload-progress-heading">
        <strong>{label}</strong>
        <span>
          {total
            ? `${processed ?? 0} / ${total} 页`
            : progress === undefined
              ? "处理中"
              : `${progress}%`}
        </span>
      </div>
      <div className="sketch-progress" aria-hidden="true">
        <FilesIcon className="sketch-pages" size={34} weight="light" />
        <div className="sketch-flight">
          <span className="sketch-trail" />
          <PaperPlaneTiltIcon size={30} weight="light" />
        </div>
        <CheckCircleIcon size={30} weight="light" />
      </div>
      <progress
        className="play-progress"
        aria-label={label}
        max={100}
        {...(total
          ? { value: Math.round(((processed ?? 0) / total) * 100) }
          : progress === undefined
            ? {}
            : { value: progress })}
      />
      <p className="progress-note">
        {total
          ? processed === total
            ? "逐页处理完成，正在汇总评审；汇总完成后才能进入评审。"
            : `已处理 ${processed ?? 0} 页，正在等待下一页结果。逐页进度包含处理尝试，最终结果以评审为准。`
          : progress === undefined
            ? "正在处理文稿，完成后更新实际页数与状态。"
            : "按实际传输字节更新，上传完成后继续解析。"}
      </p>
      <div className="game-heading">
        <div>
          <b>等一会儿，收集一点灵感</b>
          <p>点亮星星，看看你能收集多少颗。</p>
        </div>
        <span className="game-score" aria-live="polite">
          {score} 颗
        </span>
      </div>
      {playing && (
        <div className="inspiration-grid" aria-label="收集星星游戏">
          {Array.from({ length: 9 }, (_, index) => (
            <button
              type="button"
              key={index}
              className={index === position ? "star-cell lit" : "star-cell"}
              aria-label={index === position ? "收集星星" : "空格"}
              aria-disabled={index !== position}
              onClick={() => {
                if (index === position) {
                  setScore((value) => value + 1);
                  setPosition(
                    (current) =>
                      (current + 1 + Math.floor(Math.random() * 8)) % 9,
                  );
                }
              }}
            >
              <StarIcon
                size={26}
                weight={index === position ? "fill" : "thin"}
              />
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        className="button game-toggle"
        onClick={() => setPlaying((value) => !value)}
      >
        {playing ? "收起小游戏" : "玩一局收集星星"}
      </button>
      <small>游戏不会影响上传、解析或 AI 分析。</small>
    </section>
  );
}
