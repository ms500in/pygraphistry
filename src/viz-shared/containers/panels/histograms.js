import React from 'react'
// import styles from './styles.less';
import classNames from 'classnames';
import { connect } from 'reaxtor-redux';
import { HistogramsFragment, HistogramFragment } from './fragments';
import { Button, Panel, MenuItem, ListGroup, ListGroupItem } from 'react-bootstrap';

export const Histograms = connect(
     HistogramsFragment, (histograms) => ({
     histograms, name: histograms.name, open: histograms.open })
)(({ histograms = [], name, open }) => {
    return  !open ? null : (
        <h3>Histograms</h3>
        // <ListGroup fill>
        // {histograms.map((exclusion) => (
        //     <ListGroupItem key={exclusion.key}>
        //         <Exclusion falcor={exclusion}/>
        //     </ListGroupItem>
        // ))}
        // </ListGroup>
    );
});