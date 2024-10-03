// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Helmet } from 'react-helmet-async';
import { useSetAtom } from 'jotai';
import { useEffect } from 'react';
import tinycolor from 'tinycolor2';
import { useBuffers, useReportMeta } from '../hooks/useAPI';
import { reportMetaAtom } from '../store/app';
import { BufferType } from '../model/BufferType';
import { BufferSummaryConfiguration } from '../definitions/PlotConfigurations';
import MemoryPlotRenderer from '../components/operation-details/MemoryPlotRenderer';

export default function BufferSummary() {
    const report = useReportMeta();
    const setMeta = useSetAtom(reportMetaAtom);
    const { data: buffersByOperation, isLoading } = useBuffers(BufferType.L1);

    // Needs to be in a useEffect to avoid a bad setState call
    useEffect(() => {
        if (report.status === 'success' && report.data) {
            setMeta(report.data);
        }
    }, [report, setMeta]);

    const slimBuffersByOperation = buffersByOperation?.slice(250, 300);

    const memorySize = slimBuffersByOperation
        ? slimBuffersByOperation
              .map((operations) => operations.buffers.map((buffer) => buffer.address + buffer.size))
              .flat()
              .sort((a, b) => b - a)[0]
        : 0;

    return (
        <>
            <Helmet title='Buffer summary' />

            {slimBuffersByOperation && !isLoading
                ? slimBuffersByOperation.map((operation) => (
                      <MemoryPlotRenderer
                          key={operation.id}
                          chartDataList={[
                              operation.buffers.map((buffer) => ({
                                  x: [buffer.address],
                                  y: [1],
                                  type: 'bar',
                                  width: [buffer.size],
                                  marker: {
                                      color: tinycolor.random().toRgbString(),
                                      line: {
                                          width: 0,
                                          opacity: 0,
                                          simplify: false,
                                      },
                                  },
                                  name: operation.id.toString(),
                              })),
                          ]}
                          isZoomedIn={false}
                          memorySize={memorySize}
                          configuration={BufferSummaryConfiguration}
                          // onClick={onBufferClick}
                          // onHover={(data) => setHoveredPoint(data.points[0].x as number)}
                          // onUnhover={() => setHoveredPoint(null)}
                      />
                  ))
                : null}
        </>
    );
}
